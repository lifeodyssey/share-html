# Share HTML

<p align="center">
  <a href="https://sharehtml.zhenjia.dev">
    <img src="./public/logo.svg" alt="Share HTML logo" width="112" height="112">
  </a>
</p>

<p align="center">
  Upload one HTML file, then share a sandboxed preview as an unlisted public link or an access-key-protected private link.
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
- Public-unlisted and access-key-protected private-link visibility modes.
- Share page with status, risk score, and embedded preview after any required private-link unlock.
- Direct preview URL for opening the uploaded HTML by itself.
- Lightweight scanner for suspicious HTML patterns.
- Report API and admin moderation endpoints.

## URL Model

Share HTML intentionally exposes two different URL surfaces after upload:

- **Share URL** opens the wrapper page at `/s/:slug`. This is the best link to send because it includes status, safety context, the report action, and the embedded preview.
- **Preview URL** opens the sandboxed HTML render at `/v/:slug/`. For a private link it requires the short-lived preview cookie created during unlock.
- **Claim token** is private. Use it with the share ID after signing in if you want to move an anonymous upload into your account.

Each upload also chooses one visibility:

- **`public_unlisted`** is the default. Anyone who knows the URL can read its metadata and open its preview. Share and preview routes are marked noindex and never added to `sitemap.xml`, but unlisted is not the same as authenticated.
- **`private_link`** returns a 32-byte base64url `accessKey`. The returned `share.share_url` carries the key in a client-side `#key=` fragment so the initial HTTP request does not send it to the server. Treat the complete private URL as a secret.

`claimToken` and `accessKey` are deliberately different capabilities: the first transfers ownership after sign-in; the second opens a private link and does not grant ownership.

## HTTP API

Create a public-unlisted share (the default):

```bash
curl -X POST https://sharehtml.zhenjia.dev/api/shares \
  -F 'file=@page.html' \
  -F 'title=My page'
```

Create a private link:

```bash
curl -X POST https://sharehtml.zhenjia.dev/api/shares \
  -F 'file=@page.html' \
  -F 'visibility=private_link'
```

Both success responses use the same shape:

```json
{
  "share": { "id": "...", "slug": "...", "share_url": "...", "preview_url": "..." },
  "claimToken": "... or null",
  "accessKey": "... or null",
  "message": "Uploaded."
}
```

`accessKey` is `null` for `public_unlisted`. To unlock a private link without the browser wrapper:

```bash
curl -X POST https://sharehtml.zhenjia.dev/api/shares/SLUG/access \
  -H 'content-type: application/json' \
  --data '{"accessKey":"PRIVATE_ACCESS_KEY"}'
```

Success returns `{ "share": ... }` and sets two short-lived, host-only HttpOnly grants: one scoped to `/v/:slug` for the preview and one scoped to the exact unlock endpoint so a refresh can restore metadata after the browser removes `#key` from its address bar. A bare `GET /api/public/shares/:slug` for a private link returns `401` with `code: "share_access_required"`; a wrong key returns `403` with `code: "invalid_share_access_key"`. Never move the key into a query parameter or expose the complete private URL in logs, issue reports, or public output.

An authenticated owner can replace a lost or exposed private key with `POST /api/shares/:id/access-key`. Rotation returns the new key once and immediately invalidates metadata and preview grants issued for the previous key.

## Agent Access

Share HTML is built to be discoverable and usable by AI agents, not just humans:

- **`llms.txt`** — AI-readable site guide (also served from `/` when the request sends `Accept: text/markdown`).
- **`openapi.json`** — machine-readable HTTP API description, including both visibility modes and the private unlock/cookie flow. The homepage HTML also embeds static content + JSON-LD so non-JS agents can read what the site is and how to call it.
- **MCP machine endpoint** — [`https://share-html.zhenjiazhou0127.workers.dev/mcp`](https://share-html.zhenjiazhou0127.workers.dev/mcp) exposes `describe_share_html`, `get_public_share`, and `create_share`. It uses the same production Worker as the branded site while avoiding zone-level browser-bot policy on machine-to-machine traffic. The page exposes the same tools in-browser via WebMCP (`navigator.modelContext`).
- **`/a2a`** — A2A 1.0 JSON-RPC endpoint with an implemented `describe_share_html` skill; its card intentionally advertises only that executable A2A capability.
- **WebMCP `create_share`** lets an agent choose `public_unlisted` or `private_link`; **`access_private_share`** exchanges an access key for metadata plus the scoped metadata and preview grants. Both run through the normal HTTP API.
- **MCP `create_share`** supports both `public_unlisted` and `private_link`. It runs through the **same anonymous rate limit and risk scanner** as the web upload — there is no bypass path, and private creation returns its key once.
- **Discovery files**: `robots.txt` (with explicit AI-bot rules), `sitemap.xml`, `auth.md`, and `/.well-known/` resources (`api-catalog`, `mcp/server-card.json`, `webmcp.json`, `agent-skills`, `agent-card.json`, OAuth/OIDC metadata, `security.txt`). Unknown `/.well-known/` paths return `404` rather than the SPA shell.

The first-party homepage and discovery documentation opt into search indexing and real-time AI input while opting out of AI training through a response-level `Content-Signal`. User-supplied share metadata and previews send the stricter `search=no, ai-input=no, ai-train=no, use=immediate`, are noindex, and never appear in the sitemap. This response-level split keeps first-party GEO permissions from being applied to uploaded content on the same host.

## Acquisition Loop

The product now has four crawlable, first-party entry pages rather than relying on discovery files alone:

- [`/html-preview`](https://sharehtml.zhenjia.dev/html-preview) explains the single-file preview boundary and includes an upload CTA.
- [`/private-html-sharing`](https://sharehtml.zhenjia.dev/private-html-sharing) explains access-key privacy and its limits.
- [`/examples`](https://sharehtml.zhenjia.dev/examples) offers three self-contained files that can be preloaded into the uploader.
- [`/agents`](https://sharehtml.zhenjia.dev/agents) provides working MCP, HTTP, OpenAPI, WebMCP, Skill, and A2A entry points.

Only these pages and the homepage are submitted in `sitemap.xml`. Uploaded `/s/:slug` and `/v/:slug/` URLs remain noindex and are excluded from every discovery submission. Wrapper pages include a visible “Share your HTML” CTA; its `source=shared_preview` value is stored only in the existing `created` event metadata alongside `visibility`, which makes product-led activation measurable without adding a new tracking service.

The canonical official MCP Registry identity is **`dev.zhenjia/share-html`**, authenticated by an Ed25519 public key published in `zhenjia.dev` DNS. Its descriptor is [`server.json`](./server.json), and its homepage link points agents to the live integration guide at `/agents`. The remote itself stays on the production `workers.dev` machine endpoint; human-facing pages and canonical URLs remain on `sharehtml.zhenjia.dev`. This split prevents Free-plan Bot Fight Mode on the branded zone from rejecting legitimate data-center MCP clients.

The manual `Publish MCP Registry metadata` workflow verifies the live manifest and MCP tool list, publishes the branded identity with the `production` Environment secret `MCP_REGISTRY_PRIVATE_KEY`, verifies the exact Registry projection, and only then marks the legacy `io.github.lifeodyssey/share-html` identity as deprecated with a migration message. Registry versions cannot currently be unpublished, so the workflow is deliberately idempotent and requires typing `publish-dev-zhenjia` after the production endpoint has been deployed and verified. Never place the DNS authentication private key in the repository, Worker configuration, logs, or workflow artifacts.

IndexNow uses an explicit first-party allowlist rather than Cloudflare Crawler Hints, because this hostname also serves private and unlisted URLs:

```bash
npm run growth:indexnow:dry-run
printf '%s' '<8-to-128-character-key>' | npx wrangler secret put INDEXNOW_KEY
INDEXNOW_KEY='<same-key>' npm run growth:indexnow
```

The Worker serves `/{INDEXNOW_KEY}.txt` only when that environment value is configured. The submit script refuses `/s/`, `/v/`, `/api/`, and cross-origin URLs before contacting the global IndexNow endpoint.

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
printf '%s' '<independent-random-32-byte-secret>' | npx wrangler secret put SHARE_ACCESS_PEPPER_V1
printf '%s' '<different-random-32-byte-secret>' | npx wrangler secret put PREVIEW_GRANT_SIGNING_KEY_V1
printf '%s' '<8-to-128-character-key>' | npx wrangler secret put INDEXNOW_KEY
printf '%s' 'v1,whsec_...' | npx wrangler secret put SUPABASE_SEND_EMAIL_HOOK_SECRET
```

`SHARE_ACCESS_PEPPER_V1` derives the stored access-key hash; `PREVIEW_GRANT_SIGNING_KEY_V1` signs the short-lived metadata and preview grants. Generate them independently and do not replace either V1 value in place: add a new version and migrate stored `access_key_version` values when rotating the derivation scheme, and support a signing-key overlap window when rotating grants.

Public previews may use a separate `PREVIEW_ORIGIN`. Private previews deliberately use `APP_ORIGIN` because their short-lived authorization cookie is host-only and scoped to `/v/{slug}`; the response CSP sandbox omits `allow-same-origin`, so uploaded HTML cannot inherit the app origin or read its storage.

Create the R2 bucket once:

```bash
npx wrangler r2 bucket create share-html-prod
```

Apply all Supabase migrations in filename order. For an existing deployment, apply [`supabase/migrations/0003_private_share_access.sql`](./supabase/migrations/0003_private_share_access.sql) and configure both versioned private-share secrets **before** deploying the Worker code from this change. The migration is backward-compatible with the existing public-only Worker; the new Worker is not compatible with the old schema because it writes `visibility`, `access_key_hash`, and `access_key_version` on every upload.

Before applying `0003`, audit existing `profiles.role = 'admin'` rows against the authoritative admin allowlist and reset any unexpected rows. The migration closes the old table-wide browser `UPDATE` grant and limits self-service profile edits to `display_name`, but it cannot determine whether an already-stored admin role is legitimate.

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

The Worker is also the source of truth for `/robots.txt`. Keep Cloudflare's dashboard-level **Managed robots.txt** injection disabled for this hostname; otherwise Cloudflare prepends a second wildcard group and Content Signals policy ahead of the Worker response.

## Security Notes

Uploaded HTML is not sanitized. It is isolated instead:

- Preview pages are streamed through a dedicated `/v/:slug/` route.
- Share pages embed previews inside an iframe sandbox.
- R2 objects are private and only read by the Worker.
- Restrictive response headers are applied to preview responses.
- A response-level CSP `sandbox` omits `allow-same-origin`, so uploaded scripts keep an opaque origin even when someone opens a preview in a top-level tab.
- Moderation state is checked before streaming uploaded content.
- Private-link metadata requires an access key, owner session, or still-valid metadata grant; previews require their separate short-lived, path-scoped HttpOnly grant.
- The private access key is carried in the share URL fragment for browser handoff; fragments are not sent in HTTP requests, but the full URL must still be handled as a secret.
- Supabase RLS requires a private Worker secret header for server-side metadata writes.
