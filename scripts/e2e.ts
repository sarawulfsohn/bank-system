// End-to-end checks against a running server (bun run dev or bun run preview).
// Usage: bun scripts/e2e.ts [baseUrl]     (default http://localhost:3000)
// Needs the fake PDFs (bun scripts/make-test-pdfs.ts) and ADMIN_EMAIL / ADMIN_PASSWORD
// from the environment or .dev.vars. Makes 2 real Workers AI extraction calls.
import { existsSync, readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? process.env.BASE ?? "http://localhost:3000").replace(/\/$/, "");
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function devVar(name: string) {
  if (process.env[name]) return process.env[name]!;
  if (!existsSync(".dev.vars")) return "";
  const line = readFileSync(".dev.vars", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, "") : "";
}
const ADMIN_EMAIL = devVar("ADMIN_EMAIL");
const ADMIN_PASSWORD = devVar("ADMIN_PASSWORD");

// ---------- tiny client with a cookie jar ----------

type Res = { status: number; headers: Headers; text: string; json: any };
const seen: string[] = []; // every response body, checked for leaked hashes at the end

class Client {
  cookies = new Map<string, string>();
  constructor(public name: string) {}

  async req(method: string, path: string, opts: { body?: unknown; form?: FormData; origin?: string | null } = {}): Promise<Res> {
    const headers: Record<string, string> = {};
    // Browsers send Origin on every non-GET request; origin: null simulates a client that doesn't
    if (method !== "GET" && opts.origin !== null) headers.Origin = opts.origin ?? BASE;
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const r = await fetch(BASE + path, { method, headers, body, redirect: "manual" });
    for (const c of r.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (!v || /max-age=0/i.test(c)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    const text = await r.text();
    seen.push(text);
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, headers: r.headers, text, json };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, body?: unknown, origin?: string | null) => this.req("POST", p, { body, origin });
  patch = (p: string, body: unknown) => this.req("PATCH", p, { body });
  del = (p: string) => this.req("DELETE", p);

  upload(file: string, force = false) {
    const fd = new FormData();
    fd.append("file", new Blob([readFileSync(`test-fixtures/${file}`)], { type: "application/pdf" }), file);
    fd.append("model", MODEL);
    fd.append("force", String(force));
    return this.req("POST", "/api/documents", { form: fd });
  }

  async waitDone(id: string) {
    for (let i = 0; i < 40; i++) {
      const r = await this.get(`/api/documents/${id}`);
      if (r.json?.status !== "processing") return r;
      await new Promise((res) => setTimeout(res, 1500));
    }
    throw new Error(`document ${id} still processing`);
  }
}

// ---------- reporting ----------

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
}
const section = (s: string) => console.log(`\n## ${s}`);

// ---------- run ----------

const run = Date.now().toString(36);
const emailA = `e2e-a-${run}@example.com`;
const emailB = `e2e-b-${run}@example.com`;
const emailC = `e2e-c-${run}@example.com`;
const PW = "correct-horse-battery";

const anon = new Client("anon");
const A = new Client("A");
const B = new Client("B");
const C = new Client("C");
const admin = new Client("admin");

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("ADMIN_EMAIL / ADMIN_PASSWORD not set (env or .dev.vars)");
  process.exit(2);
}
console.log(`Testing ${BASE}`);

section("Unauthenticated access");
check("GET /api/documents -> 401", (await anon.get("/api/documents")).status === 401);
check("GET /api/auth/me -> 401", (await anon.get("/api/auth/me")).status === 401);
for (const p of ["/", "/documents/some-id", "/admin"]) {
  const r = await anon.get(p);
  const loc = r.headers.get("location") ?? "";
  check(`GET ${p} redirects to /login`, r.status >= 300 && r.status < 400 && loc.includes("/login?next="), `${r.status} ${loc}`);
}
check("GET /login -> 200", (await anon.get("/login")).status === 200);
check("GET /api/admin/users anon -> 401", (await anon.get("/api/admin/users")).status === 401);

section("Registration");
let r = await A.post("/api/auth/register", { email: `  ${emailA.toUpperCase()} `, password: PW, role: "admin" });
check("register user A -> 201", r.status === 201, `${r.status} ${r.text}`);
const cookie = r.headers.get("set-cookie") ?? "";
check("session cookie is HttpOnly, SameSite=Lax, Path=/", /httponly/i.test(cookie) && /samesite=lax/i.test(cookie) && /path=\//i.test(cookie), cookie);
r = await A.get("/api/auth/me");
check("A is a normal user with a lowercased email (role field ignored)", r.json?.role === "user" && r.json?.email === emailA, r.text);
check("register user B -> 201", (await B.post("/api/auth/register", { email: emailB, password: PW })).status === 201);
check("duplicate email -> 409", (await anon.post("/api/auth/register", { email: emailA, password: PW })).status === 409);
check("short password -> 400", (await anon.post("/api/auth/register", { email: `x-${emailA}`, password: "short" })).status === 400);
check("signed-in user visiting /login is redirected", [302, 303, 307, 308].includes((await A.get("/login")).status));

section("Upload, cache, per-user isolation");
r = await A.upload("statement.pdf");
const docA = r.json?.id as string;
check("A uploads a PDF -> processing, returns id at once", r.status === 200 && !!docA && r.json?.cached === false, r.text);
r = await A.waitDone(docA);
check("A's document is processed", r.json?.status === "done" && !!r.json?.bank_name, `${r.json?.status} ${r.json?.error ?? ""}`);
{
  // statement.pdf has 12 lines: 4 credits (6,026.23) and 8 debits (2,936.51)
  type Tx = { line_no: number; amount: number; type: string };
  const txs: Tx[] = r.json?.transactions ?? [];
  const total = (t: string) => Math.round(txs.filter((x) => x.type === t).reduce((a, x) => a + x.amount, 0) * 100) / 100;
  check("12 transaction rows, in statement order", txs.length === 12 && txs.every((t, i) => t.line_no === i + 1), `${txs.length}`);
  check("every row has type credit/debit and a positive amount", txs.every((t) => ["credit", "debit"].includes(t.type) && t.amount > 0));
  check("credits sum to 6,026.23 and debits to 2,936.51", total("credit") === 6026.23 && total("debit") === 2936.51, `${total("credit")} / ${total("debit")}`);
  check("transaction_count matches rows and balances reconcile", r.json?.transaction_count === 12 && r.json?.reconciled === 1, `${r.json?.transaction_count} ${r.json?.reconciled}`);
}
r = await A.upload("statement.pdf");
check("A re-uploads the same PDF -> cached:true, same id", r.json?.cached === true && r.json?.id === docA, r.text);

check("B GET A's document -> 404", (await B.get(`/api/documents/${docA}`)).status === 404);
check("B DELETE A's document -> 403 (only admins delete)", (await B.del(`/api/documents/${docA}`)).status === 403);
check("B opens /documents/<A's id> page -> 404", (await B.get(`/documents/${docA}`)).status === 404);
check("A's document survived B's delete attempt", (await A.get(`/api/documents/${docA}`)).status === 200);
r = await B.upload("statement.pdf");
const docB = r.json?.id as string;
check("B uploads the same PDF -> fresh run, not A's result", r.json?.cached === false && !!docB && docB !== docA, r.text);
await B.waitDone(docB);
r = await B.get("/api/documents");
check("B's list only has B's documents", Array.isArray(r.json) && r.json.every((d: any) => d.user_id === r.json[0].user_id) && r.json.some((d: any) => d.id === docB) && !r.json.some((d: any) => d.id === docA));

section("Admin access");
r = await admin.post("/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
check("admin logs in", r.status === 200, `${r.status} ${r.text}`);
r = await admin.get("/api/auth/me");
const adminId = r.json?.id as string;
check("admin has role admin", r.json?.role === "admin");
r = await admin.get("/api/admin/documents");
check("admin sees both users' documents with owner emails", Array.isArray(r.json) &&
  r.json.some((d: any) => d.id === docA && d.owner_email === emailA) &&
  r.json.some((d: any) => d.id === docB && d.owner_email === emailB));
check("admin can open A's document", (await admin.get(`/api/documents/${docA}`)).status === 200);
check("admin /admin page -> 200", (await admin.get("/admin")).status === 200);
check("admin stats -> 200", (await admin.get("/api/admin/stats")).json?.total_documents >= 2);
check("normal user GET /admin -> 404", (await A.get("/admin")).status === 404);
check("normal user GET /api/admin/users -> 403", (await A.get("/api/admin/users")).status === 403);
check("normal user GET /api/admin/stats -> 403", (await A.get("/api/admin/stats")).status === 403);
const users = (await admin.get("/api/admin/users")).json as any[];
const idOf = (email: string) => users.find((u) => u.email === email)?.id as string;
const [idA, idB] = [idOf(emailA), idOf(emailB)];
check("normal user PATCH /api/admin/users/* -> 403", (await A.patch(`/api/admin/users/${idB}`, { action: "disable" })).status === 403);

section("Admin guard rails");
check("admin cannot demote self", (await admin.patch(`/api/admin/users/${adminId}`, { action: "demote" })).status === 400);
check("admin cannot disable self", (await admin.patch(`/api/admin/users/${adminId}`, { action: "disable" })).status === 400);
check("admin cannot delete self", (await admin.del(`/api/admin/users/${adminId}`)).status === 400);
r = await admin.get("/api/admin/users");
check("admin is still an enabled admin", r.json?.some((u: any) => u.id === adminId && u.role === "admin" && !u.disabled));
// With a second admin, self-protection still applies to that admin too
check("promote B -> ok", (await admin.patch(`/api/admin/users/${idB}`, { action: "promote" })).status === 200);
check("role change signed B out", (await B.get("/api/auth/me")).status === 401);
await B.post("/api/auth/login", { email: emailB, password: PW });
check("B (now admin) cannot demote self", (await B.patch(`/api/admin/users/${idB}`, { action: "demote" })).status === 400);
check("demote B back -> ok (another admin remains)", (await admin.patch(`/api/admin/users/${idB}`, { action: "demote" })).status === 200);

section("Disable, re-enable, password reset");
check("A has a working session", (await A.get("/api/auth/me")).status === 200);
check("admin disables A", (await admin.patch(`/api/admin/users/${idA}`, { action: "disable" })).status === 200);
check("disabled A is logged out", (await A.get("/api/auth/me")).status === 401);
r = await A.post("/api/auth/login", { email: emailA, password: PW });
check("disabled A cannot log in (generic error)", r.status === 401 && r.json?.error === "Invalid email or password", r.text);
check("admin enables A", (await admin.patch(`/api/admin/users/${idA}`, { action: "enable" })).status === 200);
check("re-enabled A can log in", (await A.post("/api/auth/login", { email: emailA, password: PW })).status === 200);
const NEWPW = "another-long-password";
check("admin resets A's password", (await admin.patch(`/api/admin/users/${idA}`, { action: "reset_password", password: NEWPW })).status === 200);
check("reset signed A out", (await A.get("/api/auth/me")).status === 401);
check("old password no longer works", (await A.post("/api/auth/login", { email: emailA, password: PW })).status === 401);
check("new password works", (await A.post("/api/auth/login", { email: emailA, password: NEWPW })).status === 200);

section("Login rate limit");
await C.post("/api/auth/register", { email: emailC, password: PW });
const codes: number[] = [];
for (let i = 0; i < 6; i++) codes.push((await anon.post("/api/auth/login", { email: emailC, password: `wrong-password-${i}` })).status);
check("5 wrong passwords -> 401 each", codes.slice(0, 5).every((c) => c === 401), codes.join(","));
check("6th wrong password within 15 min -> 429", codes[5] === 429, codes.join(","));
r = await anon.post("/api/auth/login", { email: emailC, password: PW });
check("even the right password is blocked while limited", r.status === 429);
r = await anon.post("/api/auth/login", { email: `nobody-${run}@example.com`, password: "whatever-password" });
check("unknown email gets the same generic error", r.status === 401 && r.json?.error === "Invalid email or password");

section("CSRF");
r = await A.post("/api/auth/logout", undefined, "https://evil.example");
check("cross-origin POST is rejected (403)", r.status === 403, `${r.status}`);
check("session survived the rejected cross-origin logout", (await A.get("/api/auth/me")).status === 200);
r = await A.req("DELETE", `/api/documents/${docA}`, { origin: "https://evil.example" });
check("cross-origin DELETE is rejected (403)", r.status === 403);
r = await A.post("/api/auth/logout", undefined, null);
check("POST without Origin or Sec-Fetch-Site is rejected (403)", r.status === 403);

section("Security headers");
r = await anon.get("/login");
check("X-Content-Type-Options: nosniff", r.headers.get("x-content-type-options") === "nosniff");
check("Referrer-Policy: same-origin", r.headers.get("referrer-policy") === "same-origin");
check("framing blocked", r.headers.get("x-frame-options") === "DENY" || /frame-ancestors 'none'/.test(r.headers.get("content-security-policy") ?? ""));

section("Logout");
check("logout -> 200", (await A.post("/api/auth/logout")).status === 200);
check("after logout the session is gone", (await A.get("/api/auth/me")).status === 401);

section("Cleanup (also checks cascading delete)");
for (const id of [idA, idB, idOf(emailC) ?? (await admin.get("/api/admin/users")).json.find((u: any) => u.email === emailC)?.id]) {
  if (id) await admin.del(`/api/admin/users/${id}`);
}
check("deleting A also deleted A's documents", (await admin.get(`/api/documents/${docA}`)).status === 404);
check("deleting B also deleted B's documents", (await admin.get(`/api/documents/${docB}`)).status === 404);

section("Leaks");
check("no response ever contained password_hash or a pbkdf2 hash", !seen.some((t) => /password_hash|pbkdf2\$/.test(t)));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
