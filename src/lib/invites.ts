import { getBindings } from "./db";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type InviteRow = {
  id: string;
  note: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  used_email: string | null;
};

// The token is shown once, when the link is created; only its hash is stored
export async function createInvite(adminId: string, note: string | null) {
  const { env } = await getBindings();
  const token = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO invites (id, token_hash, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, await sha256Hex(token), note?.slice(0, 100) || null, adminId, now, now + INVITE_TTL_MS)
    .run();
  return { id, token, expires_at: now + INVITE_TTL_MS };
}

export async function listInvites(): Promise<InviteRow[]> {
  const { env } = await getBindings();
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.note, i.created_at, i.expires_at, i.used_at, u.email AS used_email
       FROM invites i LEFT JOIN users u ON u.id = i.used_by
      ORDER BY i.created_at DESC LIMIT 100`
  ).all<InviteRow>();
  return results ?? [];
}

export async function revokeInvite(id: string) {
  const { env } = await getBindings();
  const res = await env.DB.prepare("DELETE FROM invites WHERE id = ? AND used_at IS NULL").bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

// Atomically uses up an invite. Returns its hash, or null when it is unknown, used or expired.
export async function claimInvite(token: string): Promise<string | null> {
  if (!token || token.length > 100) return null;
  const { env } = await getBindings();
  const hash = await sha256Hex(token);
  const now = Date.now();
  const res = await env.DB.prepare(
    "UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?"
  )
    .bind(now, hash, now)
    .run();
  return res.meta.changes ? hash : null;
}

export async function releaseInvite(hash: string) {
  const { env } = await getBindings();
  await env.DB.prepare("UPDATE invites SET used_at = NULL, used_by = NULL WHERE token_hash = ?").bind(hash).run();
}

export async function markInviteUsed(hash: string, userId: string) {
  const { env } = await getBindings();
  await env.DB.prepare("UPDATE invites SET used_by = ? WHERE token_hash = ?").bind(userId, hash).run();
}
