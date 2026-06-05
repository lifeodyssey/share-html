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
  <a href="https://github.com/lifeodyssey/share-html/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/lifeodyssey/share-html/ci.yml?branch=main&style=flat-square&label=CI"></a>
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflareworkers&logoColor=white">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Auth%20%2B%20Postgres-3FCF8E?style=flat-square&logo=supabase&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white">
</p>

## Links

- Live app: [https://sharehtml.zhenjia.dev](https://sharehtml.zhenjia.dev)
- GitHub repo: [https://github.com/lifeodyssey/share-html](https://github.com/lifeodyssey/share-html)
- Workers fallback: [https://share-html.zhenjiazhou0127.workers.dev](https://share-html.zhenjiazhou0127.workers.dev)

## Project Docs

- Product and system spec: [docs/project/spec.md](./docs/project/spec.md)
- Current progress: [docs/project/progress.md](./docs/project/progress.md)
- Roadmap: [docs/project/roadmap.md](./docs/project/roadmap.md)

## What It Does

Share HTML is a small Cloudflare-hosted tool for sharing self-contained HTML files. It is useful for quick prototypes, mockups, receipts, tiny demos, and one-off pages that need a URL without setting up a site.

- Anonymous upload flow with a 365-day expiry.
- Supabase magic-link sign-in for keeping and deleting shares, with auth email delivery handled by Cloudflare Email Service.
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

## Agent Access

Share HTML is built to be discoverable and usable by AI agents, not just humans:

- **`llms.txt`** — AI-readable site guide (also served from `/` when the request sends `Accept: text/markdown`).
- **`openapi.json`** — full API description; the homepage HTML also embeds static content + JSON-LD so non-JS agents can read what the site is and how to call it.
- **`/mcp`** — MCP (JSON-RPC) endpoint exposing `describe_share_html`, `get_public_share`, and `create_share`. The page exposes the same tools in-browser via WebMCP (`navigator.modelContext`).
- **`create_share`** lets an agent upload an HTML document and get a shareable URL. It runs through the **same anonymous rate limit and risk scanner** as the web upload — there is no bypass path.
- **Discovery files**: `robots.txt` (with explicit AI-bot rules), `sitemap.xml`, `auth.md`, and `/.well-known/` resources (`api-catalog`, `mcp/server-card.json`, `webmcp.json`, `agent-skills`, `agent-card.json`, OAuth/OIDC metadata, `security.txt`). Unknown `/.well-known/` paths return `404` rather than the SPA shell.

## Stack

- Cloudflare Workers Static Assets for the app shell and API.
- Cloudflare R2 for uploaded HTML objects.
- Cloudflare Email Service for branded auth email delivery.
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
printf '%s' 'v1,whsec_...' | npx wrangler secret put SUPABASE_SEND_EMAIL_HOOK_SECRET
```

Create the R2 bucket once:

```bash
npx wrangler r2 bucket create share-html-prod
```

Apply the Supabase migration in [`supabase/migrations/0001_share_html_schema.sql`](./supabase/migrations/0001_share_html_schema.sql).

For production magic links, add `https://sharehtml.zhenjia.dev` to the Supabase Auth site URL and redirect allow list.

The Cloudflare Email Service hook and `sharehtml@zhenjia.dev` sender setup notes live in [`docs/email/auth-email-setup.md`](./docs/email/auth-email-setup.md).

## Deploy

Production runs as a Cloudflare Worker named `share-html`. The deployment source of truth is [`wrangler.jsonc`](./wrangler.jsonc): it defines the Worker entrypoint, static assets, custom domain, R2 bucket binding, and public runtime variables.

Deployments are gated by GitHub branch protection and executed by Cloudflare Workers Builds:

- Pull requests run `npm ci`, `npm run build`, and `npx wrangler deploy --dry-run`.
- The `main` branch requires the `Build` check before changes can land.
- Cloudflare Workers Builds watches `main`, builds that branch, and deploys the Worker after merge.

This keeps Cloudflare deploy credentials out of GitHub. No Cloudflare API token or deploy hook secret is required in GitHub Actions.

Cloudflare Workers Builds setup notes live in [`docs/deploy/cloudflare-builds.md`](./docs/deploy/cloudflare-builds.md).

You can still deploy manually from a local machine with:

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
