import { getBindings } from "./db";
import type { User } from "./types";

// Append-only record of sensitive actions: who, what, on what. Never throws: a failed log
// write must not block the action, but it is reported to the Worker logs.
export async function audit(actor: Pick<User, "id" | "email"> | null, action: string, target?: string | null, detail?: unknown) {
  try {
    const { env } = await getBindings();
    await env.DB.prepare(
      "INSERT INTO audit_log (at, actor_id, actor_email, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(
        Date.now(), actor?.id ?? null, actor?.email ?? null, action, target?.slice(0, 200) ?? null,
        detail === undefined ? null : JSON.stringify(detail).slice(0, 1000)
      )
      .run();
  } catch (e) {
    console.error("audit log write failed", action, e);
  }
}

export type AuditRow = {
  id: number;
  at: number;
  actor_email: string | null;
  action: string;
  target: string | null;
  detail: string | null;
};

export async function listAudit(limit = 200): Promise<AuditRow[]> {
  const { env } = await getBindings();
  const { results } = await env.DB.prepare(
    "SELECT id, at, actor_email, action, target, detail FROM audit_log ORDER BY at DESC, id DESC LIMIT ?"
  )
    .bind(limit)
    .all<AuditRow>();
  return results ?? [];
}
