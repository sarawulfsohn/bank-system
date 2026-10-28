import { getCloudflareContext } from "@opennextjs/cloudflare";
import { recomputeOverlap } from "./overlap";
import type { AdminStats, AdminUserRow, DocRecord, Transaction, User } from "./types";

export async function getBindings() {
  const { env, ctx } = await getCloudflareContext({ async: true });
  return { env, ctx };
}

// A job that hasn't finished this long after its last update has died (the background budget is ~30 s)
export const STALE_PROCESSING_MS = 75_000;

// Everything except raw_json, which is large and internal
export const DOC_COLUMNS =
  `d.id, d.user_id, d.file_hash, d.file_name, d.file_size, d.model, d.status, d.error, d.bank_name,
   d.account_holder, d.account_type, d.account_number_last4, d.period_start, d.period_end, d.currency,
   d.opening_balance, d.closing_balance, d.total_deposits, d.total_withdrawals, d.fees_total, d.interest_total,
   d.transaction_count, d.reconciled, d.notable_items, d.text_chars, d.page_count, d.duration_ms,
   d.duplicate_of, d.superseded, d.overlap_count, d.client_key, d.pdf_producer, d.pdf_creator, d.pdf_flags,
   d.pdf_stored, d.created_at, d.updated_at, u.email AS owner_email`;
export const DOC_FROM = "FROM documents d JOIN users u ON u.id = d.user_id";

// What only reviewers should see: how the PDF was produced, duplicates and overlaps. An applicant
// shouldn't be told which checks their upload tripped.
const ADMIN_ONLY = [
  "duplicate_of", "superseded", "overlap_count", "client_key", "pdf_producer", "pdf_creator", "pdf_flags", "pdf_stored",
] as const;

function parseList(v: unknown): string[] {
  try {
    const x = typeof v === "string" ? JSON.parse(v) : [];
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function hydrateDocument(row: Record<string, unknown>, admin = false): DocRecord {
  const doc = { ...row, notable_items: parseList(row.notable_items), pdf_flags: parseList(row.pdf_flags) } as Record<string, unknown>;
  delete doc.raw_json; // internal; never send it to the client
  if (!admin) for (const k of ADMIN_ONLY) delete doc[k];
  return doc as unknown as DocRecord;
}

// Owners see their own documents; admins see any. Anything else is "not found".
export async function getDocument(id: string, user: User): Promise<DocRecord | null> {
  const { env } = await getBindings();
  const admin = user.role === "admin";
  let row = admin
    ? await env.DB.prepare(`SELECT ${DOC_COLUMNS} ${DOC_FROM} WHERE d.id = ?`).bind(id).first<Record<string, unknown>>()
    : await env.DB.prepare(`SELECT ${DOC_COLUMNS} ${DOC_FROM} WHERE d.id = ? AND d.user_id = ?`)
        .bind(id, user.id)
        .first<Record<string, unknown>>();
  if (!row) return null;

  // A background job that died leaves the row 'processing' forever: fail it so the user can retry
  if (row.status === "processing" && Date.now() - Number(row.updated_at) > STALE_PROCESSING_MS) {
    const message = "Processing didn't finish. Please upload the file again.";
    const res = await env.DB.prepare(
      "UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'processing'"
    )
      .bind(message, Date.now(), id)
      .run();
    if (res.meta.changes) row = { ...row, status: "failed", error: message };
  }

  const doc = hydrateDocument(row, admin);
  const { results } = await env.DB.prepare(
    `SELECT line_no, txn_date, description, amount, type, category, reference, balance_after
       FROM transactions WHERE document_id = ? ORDER BY line_no`
  )
    .bind(id)
    .all<Transaction>();
  doc.transactions = results ?? [];
  return doc;
}

// The signed-in user's own documents (admins included; the admin area lists everyone's)
export async function listDocuments(user: User, limit = 20): Promise<DocRecord[]> {
  const { env } = await getBindings();
  const { results } = await env.DB.prepare(
    `SELECT ${DOC_COLUMNS} ${DOC_FROM} WHERE d.user_id = ? ORDER BY d.created_at DESC LIMIT ?`
  )
    .bind(user.id, limit)
    .all<Record<string, unknown>>();
  return (results ?? []).map((r) => hydrateDocument(r, user.role === "admin"));
}

// Admin only (the callers enforce that). Returns false when there was nothing to delete.
export async function deleteDocument(id: string): Promise<boolean> {
  const { env } = await getBindings();
  const doc = await env.DB.prepare(
    "SELECT file_hash, account_number_last4 AS last4, bank_key FROM documents WHERE id = ?"
  )
    .bind(id)
    .first<{ file_hash: string; last4: string | null; bank_key: string }>();
  if (!doc) return false;

  await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(id).run();

  // The statements it overlapped may now be the only copy of those days
  await recomputeOverlap(env, doc.last4, doc.bank_key);

  // The stored original is shared by every row with the same bytes: remove it with the last one
  const others = await env.DB.prepare("SELECT 1 FROM documents WHERE file_hash = ? LIMIT 1").bind(doc.file_hash).first();
  if (!others) await env.STATEMENTS.delete(`pdf/${doc.file_hash}`).catch(() => {});
  return true;
}

// ---------- admin ----------

export async function listUsers(): Promise<AdminUserRow[]> {
  const { env } = await getBindings();
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.disabled, u.created_at, u.last_login_at, u.totp_enabled,
            (SELECT COUNT(*) FROM documents d WHERE d.user_id = u.id) AS document_count
       FROM users u ORDER BY u.created_at`
  ).all<AdminUserRow>();
  return results ?? [];
}

export async function getStats(): Promise<AdminStats> {
  const { env } = await getBindings();
  const [users, docs, byStatus, byModel, avg, failed] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM users"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM documents"),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM documents GROUP BY status ORDER BY n DESC"),
    env.DB.prepare("SELECT model, COUNT(*) AS n FROM documents GROUP BY model ORDER BY n DESC"),
    env.DB.prepare("SELECT AVG(duration_ms) AS v FROM documents WHERE status = 'done'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM documents WHERE status = 'failed' AND updated_at > ?").bind(
      Date.now() - 24 * 60 * 60 * 1000
    ),
  ]);
  const first = <T>(r: D1Result) => (r.results?.[0] ?? {}) as T;
  return {
    total_users: first<{ n: number }>(users).n ?? 0,
    total_documents: first<{ n: number }>(docs).n ?? 0,
    by_status: (byStatus.results ?? []) as AdminStats["by_status"],
    by_model: (byModel.results ?? []) as AdminStats["by_model"],
    avg_duration_ms: first<{ v: number | null }>(avg).v ?? null,
    failed_last_24h: first<{ n: number }>(failed).n ?? 0,
  };
}
