import { NextResponse } from "next/server";
import { deleteDocument, getBindings } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  assertSameOrigin, errorResponse, hashPassword, HttpError, passwordProblem, readJson,
  requireAdmin, revokeUserSessions,
} from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };
type Action = "promote" | "demote" | "disable" | "enable" | "reset_password" | "reset_2fa";
const ACTIONS: Action[] = ["promote", "demote", "disable", "enable", "reset_password", "reset_2fa"];

// Appended to a WHERE clause: true unless the target is the last enabled admin.
// Kept inside the statement so two admins acting at once can't both get past it.
const NOT_LAST_ADMIN =
  "(role <> 'admin' OR (SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?1) >= 1)";

async function loadTarget(id: string) {
  const { env } = await getBindings();
  const target = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first();
  if (!target) throw new HttpError(404, "User not found");
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    assertSameOrigin(req);
    const me = await requireAdmin();
    const { id } = await params;
    const body = await readJson(req);
    const action = body.action as Action;
    if (!ACTIONS.includes(action)) throw new HttpError(400, "Unknown action");
    await loadTarget(id);
    if (id === me.id && action !== "reset_password")
      throw new HttpError(400, "You can't change your own role or status");

    const { env } = await getBindings();
    let sql: string;
    let args: unknown[] = [id];
    switch (action) {
      case "promote":
        sql = "UPDATE users SET role = 'admin' WHERE id = ?1";
        break;
      case "demote":
        sql = `UPDATE users SET role = 'user' WHERE id = ?1 AND ${NOT_LAST_ADMIN}`;
        break;
      case "disable":
        sql = `UPDATE users SET disabled = 1 WHERE id = ?1 AND ${NOT_LAST_ADMIN}`;
        break;
      case "enable":
        sql = "UPDATE users SET disabled = 0 WHERE id = ?1";
        break;
      case "reset_2fa":
        // Recovery for an admin who lost their authenticator
        sql = "UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?1";
        break;
      case "reset_password": {
        const problem = passwordProblem(body.password);
        if (problem) throw new HttpError(400, problem);
        sql = "UPDATE users SET password_hash = ?2 WHERE id = ?1";
        args = [id, await hashPassword(body.password as string)];
        break;
      }
    }
    const res = await env.DB.prepare(sql).bind(...args).run();
    if (!res.meta.changes) throw new HttpError(409, "The last remaining admin can't be demoted or disabled");

    // Role, status and password changes all end the user's existing sessions
    if (action !== "enable") await revokeUserSessions(id);
    await audit(me, `user.${action}`, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    assertSameOrigin(req);
    const me = await requireAdmin();
    const { id } = await params;
    await loadTarget(id);
    if (id === me.id) throw new HttpError(400, "You can't delete your own account");

    // Sessions go with the user (ON DELETE CASCADE). Documents are removed one by one first so their
    // stored originals are cleaned up and overlap flags on other statements are recomputed.
    const { env } = await getBindings();
    const { results: docs } = await env.DB.prepare("SELECT id FROM documents WHERE user_id = ?").bind(id).all<{ id: string }>();
    const last = await env.DB.prepare("SELECT role, disabled FROM users WHERE id = ?").bind(id).first<{ role: string; disabled: number }>();
    if (last?.role === "admin") {
      const others = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?").bind(id).first<{ n: number }>();
      if (!others?.n) throw new HttpError(409, "The last remaining admin can't be deleted");
    }
    for (const d of docs ?? []) await deleteDocument(d.id);
    const res = await env.DB.prepare(`DELETE FROM users WHERE id = ?1 AND ${NOT_LAST_ADMIN}`)
      .bind(id)
      .run();
    if (!res.meta.changes) throw new HttpError(409, "The last remaining admin can't be deleted");
    await audit(me, "user.delete", id, { documents: docs?.length ?? 0 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
