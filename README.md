# Share HTML

Upload a single HTML file, get an unlisted share link, and let others view it in a sandboxed preview.

Live app: https://sharehtml.zhenjia.org

## Stack

- Cloudflare Workers Static Assets for the app shell and API.
- Cloudflare R2 for uploaded HTML.
- Supabase Auth for users.
- Supabase Postgres for share metadata, reports, and moderation state.

## Local Setup

```bash
npm install
cp .env.example .dev.vars
npm run build
npm run dev
```

Set these Cloudflare Worker secrets before production deploy:

```bash
printf '%s' '<legacy-anon-key>' | npx wrangler secret put SUPABASE_REST_KEY
printf '%s' '<worker-api-secret>' | npx wrangler secret put WORKER_API_SECRET
printf '%s' '<random-salt>' | npx wrangler secret put IP_HASH_SALT
```

Create the R2 bucket once:

```bash
npx wrangler r2 bucket create share-html-prod
```

Apply the Supabase migration in `supabase/migrations/0001_share_html_schema.sql`.

For production magic links, add `https://sharehtml.zhenjia.org` to the Supabase Auth site URL and redirect allow list.

## MVP Features

- Anonymous uploads with a 7-day expiry.
- Supabase-authenticated dashboard.
- Claim token for anonymous uploads.
- Sandboxed iframe preview.
- Lightweight risk scoring.
- Reports and admin block/unblock APIs.

## Security Notes

User HTML is not sanitized. It is instead isolated through preview routing, iframe sandboxing, restrictive headers, R2-only object access, and moderation state checks before streaming.

The Worker does not need a Supabase service-role key. RLS policies require a private `x-worker-secret` header for server-side metadata operations.
