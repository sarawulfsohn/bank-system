import { NextResponse } from "next/server";
import { getBindings, listDocuments } from "@/lib/db";
import { assertSameOrigin, errorResponse, requireUser } from "@/lib/auth";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";
import { processDocument } from "@/lib/extract";
import { recomputeOverlap } from "@/lib/overlap";
import type { User } from "@/lib/types";

const MAX_BYTES = 10 * 1024 * 1024;
const STALE_MS = 3 * 60 * 1000;

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    return await upload(req, await requireUser());
  } catch (e) {
    return errorResponse(e);
  }
}

async function upload(req: Request, user: User) {
  const { env, ctx } = await getBindings();

  const form = await req.formData();
  const file = form.get("file");
  const model = String(form.get("model") || DEFAULT_MODEL);

  if (!(file instanceof File))
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf")
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
  if (file.size === 0)
    return NextResponse.json({ error: "The file is empty" }, { status: 400 });
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "File is larger than 10 MB" }, { status: 413 });
  if (!MODELS.some((m) => m.id === model))
    return NextResponse.json({ error: "Unknown model" }, { status: 400 });

  const bytes = await file.arrayBuffer();
  const hash = toHex(await crypto.subtle.digest("SHA-256", bytes));

  // Uploads per user per rolling day. Each new statement can cost an AI run, so this bounds the spend
  // one account (or a script using one) can cause. Re-reading an existing result is free and not counted.
  const limit = Number(env.DAILY_UPLOAD_LIMIT) || 30;
  const known = await env.DB.prepare("SELECT 1 FROM documents WHERE user_id = ? AND file_hash = ?").bind(user.id, hash).first();
  if (!known) {
    const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM documents WHERE user_id = ? AND created_at > ?")
      .bind(user.id, Date.now() - 24 * 60 * 60 * 1000)
      .first<{ n: number }>();
    if ((used?.n ?? 0) >= limit)
      return NextResponse.json(
        { error: `Daily upload limit reached (${limit} statements). Please try again tomorrow.` },
        { status: 429 }
      );
  }

  // Keep the original: reviewers check the extracted numbers against it. Keyed by content, so
  // identical files share one object.
  const storeOriginal = async () => {
    try {
      if (!(await env.STATEMENTS.head(`pdf/${hash}`)))
        await env.STATEMENTS.put(`pdf/${hash}`, bytes, { httpMetadata: { contentType: "application/pdf" } });
      await env.DB.prepare("UPDATE documents SET pdf_stored = 1 WHERE file_hash = ?").bind(hash).run();
    } catch (e) {
      console.error("could not store original", e);
    }
  };

  const find = () =>
    env.DB.prepare("SELECT id, status, updated_at FROM documents WHERE user_id = ? AND file_hash = ?")
      .bind(user.id, hash)
      .first<{ id: string; status: string; updated_at: number }>();

  const existing = await find();

  if (existing) {
    const inFlight =
      existing.status === "processing" && Date.now() - existing.updated_at < STALE_MS;

    // Already running: just attach to it
    if (inFlight)
      return NextResponse.json({ id: existing.id, status: "processing", cached: false });

    // This user already uploaded it: read back the saved result, nothing is re-run or rewritten
    if (existing.status === "done")
      return NextResponse.json({ id: existing.id, status: "done", cached: true });

    // Failed or stale: retry the same row
    await env.DB.prepare(
      "UPDATE documents SET status='processing', error=NULL, model=?, file_name=?, updated_at=? WHERE id=?"
    )
      .bind(model, file.name.slice(0, 255), Date.now(), existing.id)
      .run();
    ctx.waitUntil(storeOriginal());
    ctx.waitUntil(processDocument(env, existing.id, file.name, bytes, model));
    return NextResponse.json({ id: existing.id, status: "processing", cached: false });
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  // Someone else already uploaded these exact bytes: give this user their own copy of the
  // saved result instead of running the AI again, and mark it as a duplicate for admins.
  const donor = await env.DB.prepare(
    "SELECT id FROM documents WHERE file_hash = ? AND status = 'done' ORDER BY created_at LIMIT 1"
  )
    .bind(hash)
    .first<{ id: string }>();
  if (donor) {
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO documents
             (id, user_id, file_hash, file_name, file_size, model, status, bank_name, account_holder, account_type,
              account_number_last4, period_start, period_end, currency, opening_balance, closing_balance,
              total_deposits, total_withdrawals, fees_total, interest_total, transaction_count, reconciled,
              notable_items, raw_json, text_chars, page_count, duration_ms, duplicate_of, client_key, bank_key,
              pdf_producer, pdf_creator, pdf_flags, pdf_stored, created_at, updated_at)
           SELECT ?1, ?2, file_hash, ?3, file_size, model, 'done', bank_name, account_holder, account_type,
                  account_number_last4, period_start, period_end, currency, opening_balance, closing_balance,
                  total_deposits, total_withdrawals, fees_total, interest_total, transaction_count, reconciled,
                  notable_items, raw_json, text_chars, page_count, duration_ms, COALESCE(duplicate_of, id), client_key, bank_key,
                  pdf_producer, pdf_creator, pdf_flags, pdf_stored, ?4, ?4
             FROM documents WHERE id = ?5`
        ).bind(id, user.id, file.name.slice(0, 255), now, donor.id),
        env.DB.prepare(
          `INSERT INTO transactions
             (document_id, line_no, txn_date, description, amount, type, category, reference, balance_after)
           SELECT ?1, line_no, txn_date, description, amount, type, category, reference, balance_after
             FROM transactions WHERE document_id = ?2`
        ).bind(id, donor.id),
      ]);
      const d = await env.DB.prepare("SELECT account_number_last4 AS last4, bank_key FROM documents WHERE id = ?")
        .bind(id)
        .first<{ last4: string | null; bank_key: string }>();
      if (d) await recomputeOverlap(env, d.last4, d.bank_key);
      return NextResponse.json({ id, status: "done", cached: true });
    } catch {
      // Raced with another identical upload by this user: fall through to the normal lookup below
      const winner = await find();
      if (winner) return NextResponse.json({ id: winner.id, status: winner.status, cached: winner.status === "done" });
    }
  }

  try {
    await env.DB.prepare(
      `INSERT INTO documents (id, user_id, file_hash, file_name, file_size, model, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?)`
    )
      .bind(id, user.id, hash, file.name.slice(0, 255), file.size, model, now, now)
      .run();
  } catch {
    // Two identical uploads by the same user raced: use the row that won
    const winner = await find();
    if (winner)
      return NextResponse.json({
        id: winner.id,
        status: winner.status,
        cached: winner.status === "done",
      });
    return NextResponse.json({ error: "Could not save the document" }, { status: 500 });
  }

  // Respond immediately; do the heavy work after the response is sent
  ctx.waitUntil(storeOriginal());
  ctx.waitUntil(processDocument(env, id, file.name, bytes, model));
  return NextResponse.json({ id, status: "processing", cached: false });
}

export async function GET() {
  try {
    return NextResponse.json(await listDocuments(await requireUser(), 20));
  } catch (e) {
    return errorResponse(e);
  }
}
