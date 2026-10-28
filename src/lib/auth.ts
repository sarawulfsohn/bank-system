import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getBindings } from "./db";
import { decryptSecret, verifyTotp } from "./totp";
import type { Role, User } from "./types";

// Workers caps PBKDF2 at 100k iterations, but on the Free plan (10 ms CPU per request)
// 100k takes ~10x too long. 5k plus a secret pepper keeps a login inside the limit.
// Each hash records its own iteration count, so this can be raised later.
const PBKDF2_ITERATIONS = 5_000;
const MAX_ITERATIONS = 100_000;
export const MIN_PASSWORD = 10;
const MAX_PASSWORD = 256;
const MAX_EMAIL = 254;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const SECURE_COOKIE = "__Host-session";
const PLAIN_COOKIE = "session";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Route handlers: turn HttpError into JSON, rethrow anything else
export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}

// ---------- encoding helpers ----------

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
const b64url = (bytes: Uint8Array) =>
  b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// ---------- passwords (PBKDF2-SHA256, no native deps) ----------

async function pbkdf2(input: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey("raw", input, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256
  );
  return new Uint8Array(bits);
}

// With PASSWORD_PEPPER set, the password is first HMAC'd with that secret, so a leaked
// database alone isn't enough to start guessing. Such hashes use the "pbkdf2p" scheme.
async function passwordInput(password: string, peppered: boolean) {
  const raw = new TextEncoder().encode(password);
  if (!peppered) return raw;
  const pepper = await getPepper();
  if (!pepper) return null;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
}

export async function getPepper() {
  const { env } = await getBindings();
  return env.PASSWORD_PEPPER || null;
}

export async function hashPassword(password: string) {
  const scheme = (await getPepper()) ? "pbkdf2p" : "pbkdf2";
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2((await passwordInput(password, scheme === "pbkdf2p"))!, salt, PBKDF2_ITERATIONS);
  return `${scheme}$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, saltB64, hashB64] = stored.split("$");
  const iterations = Number(iter);
  if ((scheme !== "pbkdf2" && scheme !== "pbkdf2p") || !Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS)
    return false;
  const input = await passwordInput(password, scheme === "pbkdf2p");
  if (!input) return false; // peppered hash but the pepper secret is missing
  const actual = await pbkdf2(input, unb64(saltB64), iterations);
  return timingSafeEqual(actual, unb64(hashB64));
}

// True when a stored hash should be replaced with one using the current settings
async function needsRehash(stored: string) {
  const [scheme, iter] = stored.split("$");
  const current = (await getPepper()) ? "pbkdf2p" : "pbkdf2";
  return scheme !== current || Number(iter) !== PBKDF2_ITERATIONS;
}

// Compared against for unknown emails so the response time doesn't reveal which emails exist
// (same scheme as real hashes, so it costs exactly as much to check)
async function dummyHash() {
  const scheme = (await getPepper()) ? "pbkdf2p" : "pbkdf2";
  return `${scheme}$${PBKDF2_ITERATIONS}$${b64(new Uint8Array(16))}$${b64(new Uint8Array(32))}`;
}

// ---------- input validation ----------

export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const email = v.trim().toLowerCase();
  if (email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

// Returns an error message, or null when the password is acceptable
export function passwordProblem(v: unknown): string | null {
  if (typeof v !== "string" || v.length < MIN_PASSWORD)
    return `Password must be at least ${MIN_PASSWORD} characters`;
  if (v.length > MAX_PASSWORD) return `Password must be at most ${MAX_PASSWORD} characters`;
  return null;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "Invalid request body");
  }
}

// ---------- CSRF: same-origin check for state-changing requests ----------

export function assertSameOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const host = req.headers.get("host") ?? new URL(req.url).host;
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {}
    if (originHost === host) return;
  } else if (req.headers.get("sec-fetch-site") === "same-origin") {
    return;
  }
  throw new HttpError(403, "Cross-origin request rejected");
}

// ---------- sessions ----------

const cookieOptions = (secure: boolean, expires: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure,
  expires: new Date(expires),
});

export const isSecureRequest = (req: Request) =>
  new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

export async function createSession(res: NextResponse, req: Request, userId: string) {
  const { env } = await getBindings();
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const expires = now + SESSION_TTL_MS;
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 300) || null;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)"
    ).bind(await sha256Hex(token), userId, now, expires, ua),
    env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, userId),
    // Opportunistic cleanup
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at < ?").bind(now - LOGIN_WINDOW_MS),
  ]);
  const secure = isSecureRequest(req);
  res.cookies.set(secure ? SECURE_COOKIE : PLAIN_COOKIE, token, cookieOptions(secure, expires));
}

async function readSessionCookie() {
  const jar = await cookies();
  const secure = jar.get(SECURE_COOKIE)?.value;
  if (secure) return { token: secure, secure: true };
  const plain = jar.get(PLAIN_COOKIE)?.value;
  return plain ? { token: plain, secure: false } : null;
}

export async function destroySession(res: NextResponse) {
  const c = await readSessionCookie();
  if (c) {
    const { env } = await getBindings();
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(c.token)).run();
  }
  res.cookies.set(SECURE_COOKIE, "", { ...cookieOptions(true, 0), maxAge: 0 });
  res.cookies.set(PLAIN_COOKIE, "", { ...cookieOptions(false, 0), maxAge: 0 });
}

export async function revokeUserSessions(userId: string) {
  const { env } = await getBindings();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

// The signed-in, non-disabled user for this request, or null. Cached per request.
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const c = await readSessionCookie();
  if (!c || c.token.length > 100) return null;
  const { env } = await getBindings();
  const sid = await sha256Hex(c.token);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.disabled, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(sid, now)
    .first<{ id: string; email: string; role: Role; disabled: number; expires_at: number }>();
  if (!row || row.disabled) return null;

  // Slide the expiry at most once a day. Cookies can only be written from route
  // handlers, so skip the refresh while rendering pages and do it on the next API call.
  if (row.expires_at - now < SESSION_TTL_MS - SESSION_REFRESH_MS) {
    const expires = now + SESSION_TTL_MS;
    try {
      (await cookies()).set(c.secure ? SECURE_COOKIE : PLAIN_COOKIE, c.token, cookieOptions(c.secure, expires));
      await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(expires, sid).run();
    } catch {
      /* server component render: cookies are read-only here */
    }
  }
  return { id: row.id, email: row.email, role: row.role };
});

// Route handlers: throw 401 / 403 (catch with errorResponse)
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Not signed in");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new HttpError(403, "Admins only");
  return user;
}

// Server components: redirect to /login, or 404 for non-admins
export async function requirePageUser(next: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requirePageAdmin() {
  const user = await requirePageUser("/admin");
  if (user.role !== "admin") notFound();
  return user;
}

// Only same-origin relative paths are allowed as post-login redirects
export function safeNext(v: unknown) {
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/";
  return v;
}

// Open sign-up is off unless ALLOW_REGISTRATION is "true"; otherwise people need an invite link
export async function registrationEnabled() {
  const { env } = await getBindings();
  return String(env.ALLOW_REGISTRATION ?? "false").toLowerCase() === "true";
}

// ---------- login ----------

export function clientIp(req: Request) {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

// Attempt limits, each counted separately: [key, max attempts in the window]
export type Limit = [key: string, max: number];

// Per email+IP is tight; per email alone (any IP) and per IP alone are looser, so a bot that
// rotates IPs against one account, or sprays many accounts from one IP, still hits a wall.
export const loginLimits = (email: string, ip: string): Limit[] => [
  [`${email}|${ip}`, MAX_FAILED_LOGINS],
  [`email|${email}`, MAX_FAILED_LOGINS * 4],
  [`ip|${ip}`, MAX_FAILED_LOGINS * 6],
];
export const registerLimits = (ip: string, max = 5): Limit[] => [[`reg|${ip}`, max]];

export async function overLimit(limits: Limit[]) {
  const { env } = await getBindings();
  const since = Date.now() - LOGIN_WINDOW_MS;
  const rows = await env.DB.batch(
    limits.map(([key]) => env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND attempted_at > ?").bind(key, since))
  );
  return rows.some((r, i) => ((r.results?.[0] as { n: number } | undefined)?.n ?? 0) >= limits[i][1]);
}

export async function recordAttempts(limits: Limit[]) {
  const { env } = await getBindings();
  const now = Date.now();
  await env.DB.batch(
    limits.map(([key]) => env.DB.prepare("INSERT INTO login_attempts (key, attempted_at) VALUES (?, ?)").bind(key, now))
  );
}

export async function clearFailedLogins(key: string) {
  const { env } = await getBindings();
  await env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run();
}

export type Verified = { id: string; role: Role; email: string; totpSecret: string | null };

// Returns the user when the password is right (and the account is enabled). totpSecret is set
// when they have two-factor on: the caller must then check a code before signing them in.
// Always does one hash comparison.
export async function checkCredentials(email: string, password: string): Promise<Verified | null> {
  const { env } = await getBindings();
  const user = await env.DB.prepare(
    "SELECT id, email, role, password_hash, disabled, totp_enabled, totp_secret FROM users WHERE email = ?"
  )
    .bind(email)
    .first<{ id: string; email: string; role: Role; password_hash: string; disabled: number; totp_enabled: number; totp_secret: string | null }>();
  const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHash()));
  if (!user || !ok || user.disabled) return null;
  // Move old hashes to the current scheme / iteration count on a successful login
  if (await needsRehash(user.password_hash))
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(await hashPassword(password), user.id)
      .run();
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    totpSecret: user.totp_enabled ? user.totp_secret ?? "" : null,
  };
}

// True when the code is valid for this user and hasn't been used before. A used code is
// recorded in the same statement that checks it, so two requests can't both pass with it.
export async function checkTotp(userId: string, stored: string, code: string) {
  const pepper = await getPepper();
  if (!pepper) return false;
  const secret = await decryptSecret(stored, pepper);
  if (!secret) return false;
  const step = await verifyTotp(secret, code.trim());
  if (step === null) return false;
  const { env } = await getBindings();
  const res = await env.DB.prepare(
    "UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)"
  )
    .bind(step, userId, step)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------- admin bootstrap ----------

let adminSeeded = false;

// Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD if no admin exists yet.
// Never touches an existing account, so env can't overwrite a password or promote a user.
export async function ensureAdminSeeded() {
  if (adminSeeded) return;
  const { env } = await getBindings();
  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").first();
  if (exists) {
    adminSeeded = true;
    return;
  }
  const email = normalizeEmail(env.ADMIN_EMAIL);
  const password = env.ADMIN_PASSWORD;
  if (!email || passwordProblem(password)) return;

  const taken = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (taken) {
    console.warn("ADMIN_EMAIL belongs to an existing non-admin account; admin was not seeded");
    return;
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)"
  )
    .bind(crypto.randomUUID(), email, await hashPassword(password), Date.now())
    .run();
  adminSeeded = true;
}
