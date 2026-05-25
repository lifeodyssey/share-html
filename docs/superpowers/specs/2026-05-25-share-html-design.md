# Share HTML Design

## Goal

Build a small Cloudflare-hosted product where users can upload a single HTML file, receive a public unlisted share link, and let others view the page online. JavaScript is allowed, but user HTML is always treated as untrusted content and rendered through a sandboxed preview path.

## Product Scope

Version 1 supports:

- Single `.html` uploads.
- Anonymous temporary shares.
- Supabase-authenticated users who can manage their own shares.
- Public unlisted links with random slugs.
- Sandboxed iframe previews.
- Cloudflare R2 object storage.
- Supabase Auth and Postgres metadata.
- Lightweight risk scoring for phishing and abuse signals.
- Reports and admin block/unblock primitives.

Version 1 does not support:

- ZIP static-site uploads.
- Password-protected shares.
- Per-share subdomains.
- Full AI moderation.
- Multi-user organizations.
- Online HTML editing.

## Architecture

The app uses Cloudflare Workers Static Assets for the React frontend and a Worker for API and preview routes.

```text
Browser
  |
  | /, /s/:slug, dashboard
  v
Cloudflare Worker Static Assets
  |
  | /api/*
  v
App API Worker
  |-- Supabase Auth/Postgres
  |-- Cloudflare R2
  |
  | iframe /v/:slug/
  v
Preview Worker route
  |-- Supabase metadata check
  |-- R2 object stream
```

In production, the preview path can move to a separate domain such as `html-view.example.com`. The MVP also works on a single Workers domain because the iframe uses `sandbox` without `allow-same-origin`.

## Data Model

Supabase stores users, share metadata, assets, events, and reports. R2 stores the uploaded HTML body.

Important tables:

- `profiles`: one row per Supabase user, plus role/quota fields.
- `shares`: public slug, owner, lifecycle status, moderation status, R2 prefix, size, hash, and expiry.
- `share_assets`: v1 has one `index.html` asset; v2 can add ZIP assets.
- `share_events`: audit trail for creation, scan, report, deletion, and admin actions.
- `reports`: user-submitted abuse reports.

## Upload Flow

```text
POST /api/shares
  -> optional Supabase JWT verification
  -> IP/user rate check
  -> file size/type validation
  -> SHA-256 hash
  -> lightweight HTML risk scan
  -> insert shares(uploading)
  -> put R2 shares/{share_id}/index.html
  -> insert share_assets(index.html)
  -> update shares(active | needs_review | blocked)
```

Anonymous uploads default to a 7-day expiry and receive a claim token. After login, the user can claim the anonymous share and manage it from the dashboard.

## Preview Flow

```text
GET /v/:slug/
  -> lookup share by slug
  -> reject missing/deleted/expired/blocked
  -> stream R2 object
  -> attach isolation headers
```

Preview responses include restrictive browser headers and no app cookies. The share page embeds previews using:

```html
<iframe sandbox="allow-scripts allow-forms allow-popups allow-downloads"></iframe>
```

## Moderation

The first version uses an explainable rule engine:

- External password forms.
- Wallet, seed phrase, and private key language.
- Top-level navigation attempts.
- `base href` pointing at an external origin.
- `http://` mixed content.
- Suspicious short-link script sources.

Results are stored as `risk_score` and `risk_reasons`. Scores below 50 become active, 50-79 become `needs_review`, and 80+ become blocked.

## Security

- The Worker uses a private `x-worker-secret` header checked by Supabase RLS policies.
- The frontend only receives the Supabase publishable key.
- Public browser clients never talk directly to R2.
- Public preview checks status in the Worker before streaming content.
- Raw IPs and user agents are not stored; only salted hashes are kept.
- RLS is enabled on all app tables even though the Worker is the primary data access layer.

## Deployment

Cloudflare resources:

- Worker: `share-html`
- R2 bucket: `share-html-prod`
- Secrets:
  - `SUPABASE_REST_KEY`
  - `WORKER_API_SECRET`
  - `IP_HASH_SALT`

Supabase project:

- Name: `share-html`
- Ref: `hihvtuyweqxnsmqmegdt`
- Region: `ap-northeast-1`
