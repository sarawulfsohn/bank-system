# Bank Statement Parser: setup

## 1. Get the starter and drop these files in

```bash
git clone https://github.com/zalmanlew/next-ssr-workers doc-parser
cd doc-parser
echo "NEXTJS_ENV=development" > .dev.vars
bun install
```

Copy every file from this zip into that folder, replacing files that already exist
(wrangler.jsonc, next.config.ts, src/app/page.tsx, src/app/layout.tsx).

If the starter's own src/app/layout.tsx has fonts you want to keep, keep them and only
change the metadata and body classes.

## 2. shadcn/ui and Cloudflare

```bash
bunx --bun shadcn@latest init
bunx --bun shadcn@latest add button card select badge progress

bunx wrangler login
bunx wrangler d1 create doc-parser-db
```

Paste the printed database_id into wrangler.jsonc.

## 3. Types, local database, run

```bash
bun run cf-typegen
bunx wrangler d1 migrations apply doc-parser-db --local
bun run dev        # on Windows change the dev script to: next dev --turbopack
bun run preview    # test in the real Workers runtime
```

## 4. Deploy

```bash
bunx wrangler d1 migrations apply doc-parser-db --remote
bun run deploy
```

## Notes

- Nothing here has been run or deployed yet. Expect to fix small errors.
- Verify the model ids in src/lib/models.ts against https://developers.cloudflare.com/workers-ai/models/
- Do not upload real bank statements to a public demo. There is no login yet (the login phase is in CLAUDE_CODE_PROMPT.md).
