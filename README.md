# Bank Statement Parser

Upload a bank statement PDF and get the key numbers back: bank, account holder and type,
statement period, opening and closing balance, total deposits and withdrawals, fees, interest,
every transaction line (date, description, amount, credit/debit, category) and a few notable items. Results are saved per user, and uploading the
same file again returns the saved result instantly without calling the AI.

Live: https://doc-parser.banksystemsw.workers.dev

Stack: Next.js 15 (App Router, SSR) on Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare),
shadcn/ui + Tailwind v4, Workers AI, D1, bun.

## Architecture

```
browser ── POST /api/documents (PDF + model) ──► Worker (Next.js route handler)
                                                   1. requireUser(), same-origin check
                                                   2. SHA-256 of the file
                                                   3. D1 lookup on (user_id, file_hash)
                                                        done        → { cached: true }   no AI call
                                                        processing  → attach to the running job
                                                        new/failed  → insert row 'processing'
                                                   4. respond with { id } immediately
                                                   5. ctx.waitUntil(processDocument):
                                                        env.AI.toMarkdown(pdf)  → text
                                                        env.AI.run(model, …)    → JSON
                                                        normalize, reconcile, save report + transaction rows
browser ── GET /api/documents/:id every 1.5 s until status != processing
```

- **Background work:** the upload request returns at once; extraction runs in `ctx.waitUntil`.
  The whole job has a 27 s budget (Workers allow about 30 s of `waitUntil` time after the
  response), after which the document is marked failed with a "please try again" message.
- **PDF to text:** `env.AI.toMarkdown`. Its output always starts with a metadata block, so the
  "is there any text?" check only looks at the page contents. Image-only (scanned) PDFs fail
  with a clear message.
- **Extraction:** the model is asked for one compact JSON object with every key present (null
  when missing), with each transaction as a short array
  `[date, description, amount, type, category, reference, balance_after]` to keep the answer
  short. One retry if the answer isn't parsable. Both `{ response }` and OpenAI-style
  `{ choices }` outputs are handled. JSON-schema mode is not used: once every transaction is in
  the answer it made Llama 70B about 3× slower (38 s vs 13 s for 12 lines), past the time budget.
- **Totals come from the lines:** deposits, withdrawals, fees and interest printed on the
  statement are kept when present; otherwise they are summed from the transaction rows.
- **Sanity check:** with transaction rows, `opening + Σcredits − Σdebits = closing` and the printed
  totals must match the rows (±0.05); without rows, the printed totals are checked instead.
  The UI shows "Balances reconcile" or "Totals don't reconcile, verify manually".
- **Bindings:** `DB` (D1) and `AI` (Workers AI) in `wrangler.jsonc`, read with
  `getCloudflareContext({ async: true })` (`src/lib/db.ts`).

### Models (`src/lib/models.ts`)

| Model | Time (12-line statement) | Neurons | Notes |
|---|---|---|---|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (default) | ~8 s | ~127 | All fields and lines correct |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | ~17 s | ~70 | All fields correct |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | ~25 s | ~26 | Close to the time limit; signs of totals sometimes wrong (fixed in code) |

### Data (`migrations/`)

- `documents`: the report. One row per user and file (`UNIQUE(user_id, file_hash)`): file name,
  size, owner, status, error, model, timings, page count, and the statement-level details (bank,
  holder, account type and last 4 digits, period, currency, opening/closing balance, totals,
  transaction count, reconcile flag, notable items). Raw model JSON is kept for debugging and
  never sent to the browser.
- `transactions`: one row per transaction line, linked by `document_id` (deleted with its
  report): `line_no`, `txn_date`, `description`, `amount` (always positive), `type`
  (`credit` = + money in, `debit` = − money out), `category` (deposit, transfer, card, check, atm,
  fee, interest, payment, refund, other), `reference` (check number), `balance_after`.

  ```sql
  -- signed amounts for one report
  SELECT txn_date, description, CASE type WHEN 'credit' THEN amount ELSE -amount END AS signed
    FROM transactions WHERE document_id = ? ORDER BY line_no;
  ```
- `users`, `sessions`, `login_attempts`: see below.

## Authentication

- **Roles:** `user` and `admin`. Self-registration only ever creates `user`.
- **Passwords:** PBKDF2-SHA256 via Web Crypto (no native modules), 16-byte random salt, stored
  as `pbkdf2p$<iterations>$<saltB64>$<hashB64>`. The `p` means the password is first HMAC'd
  with the `PASSWORD_PEPPER` secret, so a leaked database alone isn't enough to start guessing.
  Hashes without a pepper use the `pbkdf2$` prefix and still verify. Minimum length 10.
- **Iterations: 5,000, not 100,000.** On the Workers Free plan a request gets 10 ms of CPU;
  100k iterations measured ~123 ms of CPU (5k: ~6 ms) on a laptop. The pepper makes up for most
  of the lost strength. Each hash stores its own iteration count and is upgraded on the next
  successful login, so on the Paid plan you can raise `PBKDF2_ITERATIONS` in `src/lib/auth.ts`
  (Workers caps PBKDF2 at 100k).
- **Sessions:** 32 random bytes in an `HttpOnly; SameSite=Lax; Path=/` cookie, `Secure` with the
  `__Host-` prefix on https. D1 stores only the token's SHA-256. 7 day expiry, extended at most
  once a day (from API calls, since pages can't set cookies). Logout deletes the row; disabling
  a user, changing their role or resetting their password deletes all their sessions. Expired
  sessions are purged on login.
- **Checks live in server code**, not middleware (OpenNext on Workers doesn't support Node
  middleware): `getCurrentUser()`, `requireUser()`, `requireAdmin()` in `src/lib/auth.ts`.
  Pages redirect to `/login?next=…`; API routes return 401 (not signed in) or 403 (not admin).
- **Isolation:** a user only sees and downloads their own documents, and can't delete or re-run them (submitted statements stay for reviewers; only admins delete). Another
  user's document id is a 404 in both the API and `/documents/[id]`. Admins can see and delete
  everything at `/admin`, which is a 404 for everyone else.
- **Bootstrap admin:** if no admin exists, the first login attempt creates one from the
  `ADMIN_EMAIL` / `ADMIN_PASSWORD` secrets. It never overwrites an existing account: if that
  email was already registered as a normal user, it is not promoted (otherwise anyone who
  registered the admin email first would become admin).
- **Admin guard rails:** an admin can't demote, disable or delete themselves, and the last
  enabled admin can't be demoted, disabled or deleted (enforced inside the SQL statement).
- **Hardening:** one generic "Invalid email or password" (unknown emails still run a hash
  comparison so timing matches); 5 failed logins per email+IP per 15 minutes, then 429;
  every POST/PATCH/DELETE must have a same-origin `Origin` (or `Sec-Fetch-Site: same-origin`);
  `nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY` and
  `frame-ancestors 'none'` on pages (`next.config.ts`) and static files (`public/_headers`);
  `password_hash` is never selected into an API response.
- **Sign-up is invite-only** (`ALLOW_REGISTRATION` is `"false"` in `wrangler.jsonc`). Admins create
  single-use links under Admin > Users (valid 7 days, stored hashed, shown once). Set the var to
  `"true"` for open sign-up. Either way, sign-up attempts are limited to 5 per IP per 15 minutes
  (`REGISTER_RATE_LIMIT` var to change).
- **Upload cap:** `DAILY_UPLOAD_LIMIT` statements per user per rolling day (default 30), since each new
  statement can cost an AI run. Re-reading an existing result is free and doesn't count.
- **Login throttling:** per email+IP (5), per email from any IP (20) and per IP (30) per 15 minutes.
- **Admin two-factor (TOTP):** Admin > My security. The secret is stored AES-GCM encrypted under a key
  derived from `PASSWORD_PEPPER`, and each code works once. A lost authenticator is reset by another
  admin (Users > Reset 2FA). Admin pages nag until it is on.
- **Audit log** (Admin > Audit log): admin sign-ins, CSV exports, original-PDF downloads, deletions,
  invites and account changes.
- **Privacy notice** at `/privacy` describes what is collected and who sees it. Have the business
  that runs this review the wording.
- **Headers:** a full Content-Security-Policy and HSTS in production (`next.config.ts`).

## Local setup

```bash
bun install
cp .dev.vars.example .dev.vars        # then fill in ADMIN_EMAIL, ADMIN_PASSWORD, PASSWORD_PEPPER
bun run cf-typegen
bunx wrangler login                   # Workers AI always runs remotely, even in local dev
bunx wrangler d1 migrations apply doc-parser-db --local
bun run dev                           # http://localhost:3000
bun run preview                       # same app in the real Workers runtime, http://127.0.0.1:8787
```

Local dev calls Workers AI on your account (it counts against the free daily allowance), and
needs a workers.dev subdomain registered on the account. `.dev.vars` is gitignored; never
commit it.

### Tests

```bash
bun test                             # unit tests: matching keys, overlap SQL on real SQLite, chunking, TOTP, filters
bun run check                        # type check + lint + tests (what CI runs)
bun scripts/make-test-pdfs.ts         # fake statements in test-fixtures/ (no real data)
bun scripts/e2e.ts                    # against bun run dev
bun scripts/e2e.ts http://127.0.0.1:8787   # against bun run preview
```

`scripts/e2e.ts` (71 checks) needs `ALLOW_REGISTRATION=true` and `REGISTER_RATE_LIMIT=100` in `.dev.vars`. It registers throwaway users, uploads, checks caching and isolation,
the transaction rows and their sums, admin access and guard rails, disable/reset, the rate limit, CSRF, headers and cookie flags,
then deletes its users. It makes 2 real AI calls per run. Don't point it at production unless
you mean to: it trips the login rate limit for its own throwaway email and needs the admin
password.

## Deploy

One-time:

```bash
bunx wrangler d1 create doc-parser-db           # put the printed id in wrangler.jsonc
bunx wrangler r2 bucket create doc-parser-statements   # originals of uploaded statements
bunx wrangler d1 migrations apply doc-parser-db --remote
bun run deploy                                  # creates the Worker
bunx wrangler secret put PASSWORD_PEPPER        # long random value; never change it later
bunx wrangler secret put ADMIN_EMAIL
bunx wrangler secret put ADMIN_PASSWORD         # at least 10 characters
```

Every later release: `bunx wrangler d1 migrations apply doc-parser-db --remote` (if there are new
migrations), then `bun run deploy`.

Live smoke test: sign in as the admin (this creates the admin account), register a normal user
in a private window, upload a statement, upload it again and see "Cached result", then check
`/admin` shows the user and the document. Afterwards check **Workers & Pages → doc-parser →
Metrics** for CPU time per request and errors.

## Limitations and next steps

- **Free plan:** 10 ms CPU per request. Logins are sized for it (see above), but a heavy page
  render can still go over now and then (error 1102). Workers AI's free allowance is 10,000
  neurons a day; one Llama 70B extraction of a 12-line statement uses ~127 (more lines, more
  neurons), so roughly 75 extractions a day.
- **Background time:** about 30 s after the response, and the model's answer is written at roughly
  0.5 s per transaction line. Statements are therefore split into ~15-line chunks read in parallel
  (12 at a time); 150 lines took about 15 s in testing, and a statement needing more than 24 chunks
  (roughly 350 lines) is refused with "upload it in parts". If a chunk's answer is broken JSON, the
  intact rows are kept and the balance check shows if any are missing. Next step for really long
  statements: move extraction to Cloudflare Workflows or Queues (no 30 s limit) so chunks run as
  separate steps.
- **Scanned PDFs are not supported** (no text layer). Next step: OCR, for example a vision model
  on page images.
- **Lines come from the LLM** and can be misread, especially by small models. The reconcile
  check catches a wrong or missing line because the sums stop adding up, but can't fix it.
- **Original PDFs are kept** in R2 (`pdf/<sha256>`, shared by identical files) so reviewers can check
  numbers against the source (Admin > document > Download the original). The PDF's own producer /
  creator fields are checked for consumer editing software (Photoshop, Word, online editors) and for
  "modified after created". These are pointers to look closer, not proof of tampering.
- **Overlaps and duplicates:** statements of the same account (bank key + last 4 digits) that overlap
  are flagged, fully covered ones are left out of totals, and partly overlapping days are counted once
  (`documents.superseded`, `overlap_count`, `transactions.counted`, recomputed whenever a statement
  is added or deleted; see `src/lib/overlap.ts`). Clients are grouped by a normalised name
  (`client_key`: "ACME, LLC" = "Acme LLC"). Statements without last 4 digits can't be matched.
- **Currencies** are not converted; a banner warns when the counted statements mix currencies.
- **Free plan CPU:** the admin tables are server-rendered, 100 rows a page; if a page ever hits the
  10 ms limit, the Workers Paid plan (about $5/month) removes the constraint and lets the password
  hash iterations go up.
