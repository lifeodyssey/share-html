# Share HTML

<p align="center">
  <a href="https://sharehtml.zhenjia.dev">
    <img src="./public/logo.svg" alt="Share HTML logo" width="112" height="112">
  </a>
</p>

<p align="center">
  Upload one HTML file, get an unlisted share page, and let others view it in a sandboxed preview.
</p>

<p align="center">
  <a href="https://sharehtml.zhenjia.dev"><img alt="Live site" src="https://img.shields.io/badge/live-sharehtml.zhenjia.dev-E85D3F?style=flat-square"></a>
  <a href="https://github.com/lifeodyssey/share-html"><img alt="Source on GitHub" src="https://img.shields.io/badge/source-GitHub-26322F?style=flat-square&logo=github"></a>
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflareworkers&logoColor=white">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Auth%20%2B%20Postgres-3FCF8E?style=flat-square&logo=supabase&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white">
</p>

## Links

- Live app: [https://sharehtml.zhenjia.dev](https://sharehtml.zhenjia.dev)
- GitHub repo: [https://github.com/lifeodyssey/share-html](https://github.com/lifeodyssey/share-html)
- Workers fallback: [https://share-html.zhenjiazhou0127.workers.dev](https://share-html.zhenjiazhou0127.workers.dev)

## What It Does

Share HTML is a small Cloudflare-hosted tool for sharing self-contained HTML files. It is useful for quick prototypes, mockups, receipts, tiny demos, and one-off pages that need a URL without setting up a site.

- Anonymous upload flow with a 7-day expiry.
- Supabase magic-link sign-in for keeping and deleting shares.
- Claim token flow for attaching an anonymous upload to an account later.
- Public share page with status, risk score, and embedded preview.
- Direct preview URL for opening the uploaded HTML by itself.
- Lightweight scanner for suspicious HTML patterns.
- Report API and admin moderation endpoints.

## URL Model

Share HTML intentionally exposes two different URLs after upload:

- **Share URL** opens the public wrapper page at `/s/:slug`. This is the best link to send to someone because it includes the title, status, safety context, report action, and embedded preview.
- **Preview URL** opens the sandboxed HTML render at `/v/:slug/`. This is useful when you only want to inspect the uploaded page itself.
- **Claim token** is private. Use it with the share ID after signing in if you want to move an anonymous upload into your account.

## Stack

- Cloudflare Workers Static Assets for the app shell and API.
- Cloudflare R2 for uploaded HTML objects.
- Supabase Auth for magic-link users.
- Supabase Postgres for metadata, reports, events, and moderation state.
- React, Vite, and TypeScript for the frontend.

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

Apply the Supabase migration in [`supabase/migrations/0001_share_html_schema.sql`](./supabase/migrations/0001_share_html_schema.sql).

For production magic links, add `https://sharehtml.zhenjia.dev` to the Supabase Auth site URL and redirect allow list.

The branded Magic Link template and `sharehtml@zhenjia.dev` sender setup notes live in [`docs/email/auth-email-setup.md`](./docs/email/auth-email-setup.md).

## Deploy

```bash
npm run deploy
```

The Worker is configured with:

- Custom domain: `sharehtml.zhenjia.dev`
- Workers fallback: `share-html.zhenjiazhou0127.workers.dev`
- R2 bucket: `share-html-prod`

## Security Notes

Uploaded HTML is not sanitized. It is isolated instead:

- Preview pages are streamed through a dedicated `/v/:slug/` route.
- Share pages embed previews inside an iframe sandbox.
- R2 objects are private and only read by the Worker.
- Restrictive response headers are applied to preview responses.
- Moderation state is checked before streaming uploaded content.
- Supabase RLS requires a private Worker secret header for server-side metadata writes.
