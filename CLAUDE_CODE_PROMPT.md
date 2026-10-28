You are continuing a project. Read the whole repo before changing anything.

## PROJECT
"Bank Statement Parser", deployed as a Cloudflare Workers project.
Stack: Next.js 15.3.5 (App Router, SSR) via @opennextjs/cloudflare (OpenNext), bun, Tailwind v4, shadcn/ui,
Workers AI (env.AI.toMarkdown for PDF to text, env.AI.run for LLM extraction), D1 database.
Bindings in wrangler.jsonc: AI and DB. Started from the zalmanlew/next-ssr-workers starter.
Access bindings with getCloudflareContext({ async: true }) from @opennextjs/cloudflare (see src/lib/db.ts).

Existing files (written but NEVER run or deployed, so expect bugs):
wrangler.jsonc, next.config.ts, migrations/0001_init.sql, src/lib/{models,types,format,db,extract}.ts,
src/app/api/documents/route.ts, src/app/api/documents/[id]/route.ts,
src/components/{result-card,auto-refresh,uploader}.tsx, src/app/{layout,page}.tsx,
src/app/documents/[id]/page.tsx.

Original task requirements, which must all still hold when you finish:
- User uploads a bank statement PDF; the server processes it in the background (POST returns an id at once,
  work runs in ctx.waitUntil, UI polls) and shows results.
- User can switch the AI model (dropdown with several Workers AI models).
- Extracted results (bank name, statement period, deposit/withdrawal totals, plus other useful fields) are saved to D1.
- If a file that was already processed is uploaded again, return the cached result without calling the AI.
- Deployed to Cloudflare Workers, Next.js SSR, shadcn UI, Workers AI, D1, Workers bindings for D1 and AI.

## PHASE 0: MAKE THE EXISTING APP ACTUALLY WORK (do this before any auth work)
1. bun install. Make sure shadcn components exist: button card select badge progress (add any that are missing).
2. Set wrangler.jsonc database_id. If no D1 database exists yet, ask me before creating one. Then run
   bun run cf-typegen so CloudflareEnv includes AI and DB.
3. Apply migrations locally (bunx wrangler d1 migrations apply doc-parser-db --local), run bun run dev,
   fix every type, lint, build and runtime error. next.config.ts has eslint.ignoreDuringBuilds on purpose;
   still keep tsc clean.
4. Test with a real PDF: generate a realistic text-based fake bank statement PDF yourself (no real data), upload it, and verify:
   extraction fields are saved in D1, the same file again returns the cached result with no AI call,
   switching models works, and a failed or scanned PDF shows a clear error.
5. Verify every model id in src/lib/models.ts against https://developers.cloudflare.com/workers-ai/models/.
   Replace any that error. The extraction code tries JSON-schema mode first and falls back to a plain prompt;
   confirm that fallback really works. Some models return { response } and others OpenAI-style { choices }; parseOutput handles both.
6. Run bun run preview (real Workers runtime build) and confirm it works there too.
Report what you fixed before starting Phase 1.

## PHASE 1: AUTHENTICATION WITH TWO ROLES (user and admin)

### Data model: new migration migrations/0002_auth.sql
- users(id TEXT PK, email TEXT UNIQUE NOT NULL (store lowercased), password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')), disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_login_at INTEGER)
- sessions(id TEXT PK = SHA-256 hex of the session token, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at, expires_at, user_agent TEXT) with indexes on user_id and expires_at
- login_attempts(key TEXT NOT NULL, attempted_at INTEGER NOT NULL) with index on (key, attempted_at)
- documents: add user_id (owner). The current UNIQUE(file_hash) is a privacy problem once there are multiple users
  (user B uploading A's file would get A's results). Change the uniqueness to UNIQUE(user_id, file_hash).
  SQLite cannot drop a column constraint in place, so rebuild the table (create new, copy, drop old, rename, recreate index).
  Existing rows have no owner: assign them to the seeded admin if there is one, otherwise delete them (it is dev data only).
  Update src/lib/types.ts, db.ts and the upload route's dedup lookup to be per user.

### Password hashing and sessions
- No native dependencies (bcrypt and argon2 do not run on Workers). Use Web Crypto PBKDF2-SHA256 with a random 16-byte
  salt, stored as "pbkdf2$<iterations>$<saltB64>$<hashB64>". Workers caps PBKDF2 at 100000 iterations; use that.
  Compare in constant time. Minimum password length 10. Watch CPU time: if the hash exceeds the Worker CPU limit on the
  plan I am using (test with bun run preview and note the result), tell me instead of silently lowering iterations.
- Session: 32 random bytes as the token, sent in an HttpOnly, SameSite=Lax, Path=/ cookie (Secure when the request is https;
  use the "__Host-" prefix only when Secure is set, plain name on http localhost). Store only the SHA-256 of the token in D1.
  7 day expiry, refreshed at most once a day. Logout deletes the row. Disabling a user, changing a role,
  or resetting a password invalidates that user's sessions. Purge expired sessions opportunistically.
- Do not depend on Next middleware for DB-backed auth (OpenNext on Cloudflare has middleware limitations; verify
  against the OpenNext docs). Put checks in server code: src/lib/auth.ts with getCurrentUser(), requireUser(), requireAdmin().
  Server components redirect to /login; route handlers return 401 JSON (not logged in) or 403 JSON (not admin).
  A light middleware that only redirects when no session cookie is present is optional, and only if it builds under opennextjs-cloudflare.

### Auth endpoints and pages
- POST /api/auth/register (creates role "user" only; never admin), POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me.
- Pages: /login and /register using shadcn Card, Input, Label, Button, Alert. After login redirect to the "next" param only if it is
  a same-origin relative path, otherwise "/". Logged-in users visiting /login are redirected to "/".
- Add a header to layout.tsx (server component): app name, signed-in email, role Badge, an "Admin" link (admins only), Logout button.
  Keep the template's fonts and styles in layout.tsx.
- Env flag ALLOW_REGISTRATION (default "true"); when "false", /register and the register API are disabled.

### Admin bootstrap (no hardcoded credentials, ever)
- Secrets ADMIN_EMAIL and ADMIN_PASSWORD. Locally they go in .dev.vars; in production use wrangler secret put.
  Add .dev.vars.example (no real values) and confirm .dev.vars is gitignored.
- Idempotent seeding: ensureAdminSeeded() runs from the login route. If no admin exists and both secrets are set, create the admin
  from them. Never overwrite an existing admin's password from env.

### Authorization rules
- Every /api/documents route and every page except /login and /register requires a signed-in, non-disabled user.
- A user sees, downloads, re-runs and deletes only their own documents. Another user's document id returns 404 (not 403), in both
  the API and the SSR page /documents/[id].
- Admin can see and delete any document. Show the owner email on admin views.
- Dedup and caching stay per user (UNIQUE(user_id, file_hash)).

### Admin area: /admin (admins only; everyone else gets 404)
- Summary cards: total users, total documents, documents by status, by model, average processing time, failures in the last 24h.
- Users table: email, role, status, created, last login, document count. Actions: promote or demote, disable or enable,
  reset password (admin sets a new one), delete user (cascades to their sessions and documents), with a confirmation dialog.
  Guard rails: an admin cannot demote, disable or delete themselves, and the last remaining admin can never be demoted, disabled or deleted.
- Documents table across all users: owner, file name, bank, period, model, status, duration, with delete.
- Admin API under /api/admin/* using requireAdmin(). Use shadcn Table, Badge, Select, AlertDialog (add the components you need).

### Hardening
- Login errors are always the generic "Invalid email or password". For unknown emails still run a dummy hash comparison so timing matches.
- Rate limit: at most 5 failed logins per email+IP per 15 minutes (login_attempts table), returning 429 with a friendly message;
  clear on success.
- CSRF: on every POST, PUT, PATCH and DELETE, require the Origin header (or Sec-Fetch-Site) to be same-origin; reject otherwise.
- Security headers via next.config.ts or a response helper: X-Content-Type-Options nosniff, Referrer-Policy same-origin,
  X-Frame-Options DENY (or CSP frame-ancestors 'none').
- Validate and normalize all input (trim and lowercase the email, length limits). Never log passwords, tokens or hashes.
- Make sure no API response ever includes password_hash.

## PHASE 2: VERIFY, DOCUMENT, PREPARE TO DEPLOY
1. Write a script (scripts/e2e.sh or a bun script) that hits the running local server and checks all of these:
   - unauthenticated requests to /api/documents get 401; unauthenticated page requests redirect to /login
   - register user A and user B; A uploads a PDF; A re-uploads it and gets cached:true
   - B cannot read or delete A's document (404); B uploading the same PDF gets a fresh processing run, not A's result
   - admin can see both users' documents; a normal user gets 404 on /admin and 403 on /api/admin/*
   - admin guard rails (cannot demote or delete self or the last admin); disabled user is logged out and cannot log in
   - the 6th wrong password within 15 minutes returns 429
   - a cross-origin POST is rejected
2. bun run cf-typegen, tsc with no errors, bun run build or bun run preview succeeds.
3. Rewrite README.md: what the app is, architecture (upload, hash check, waitUntil, toMarkdown, LLM, D1), models, auth model
   (roles, sessions, hashing, bootstrap admin), setup (.dev.vars from .dev.vars.example, migrations), deploy steps, and
   limitations (about 30s of background time after the response, scanned PDFs unsupported, totals can be misread by the LLM,
   and ideas for next steps: OCR, a transactions table with sums computed in code, Workflows or Queues for long statements).
4. Deployment checklist in the README, and DO NOT run the real deploy or touch the remote database yourself:
   bunx wrangler d1 migrations apply doc-parser-db --remote
   bunx wrangler secret put ADMIN_EMAIL
   bunx wrangler secret put ADMIN_PASSWORD
   bun run deploy
   Then a live smoke test: log in as admin, register a user, upload, re-upload and see the cache hit, check /admin.

## RULES
- Keep the original features working and the changes minimal and consistent with the existing code style.
- Never commit secrets, .dev.vars, or real bank data. Use only fake test PDFs.
- Ask me before anything destructive or remote: creating or migrating the remote D1 database, setting secrets, or deploying.
- If something in these instructions conflicts with what the code or the docs require, stop and tell me instead of guessing.
- Look up current docs when unsure (developers.cloudflare.com, opennext.js.org/cloudflare, ui.shadcn.com) rather than relying on memory.

## WHEN YOU FINISH, REPORT
1. What was broken in Phase 0 and how you fixed it.
2. A list of files added or changed.
3. The e2e results (pass or fail for each check).
4. Anything you could not verify, and the exact manual steps I still need to do (remote migration, secrets, deploy).
