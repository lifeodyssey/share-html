# Share HTML Progress

## Current Status

Share HTML is live at `https://sharehtml.zhenjia.dev` and backed by Cloudflare Workers, R2, Supabase Auth, and Supabase Postgres.

The production Worker is connected to Cloudflare Workers Builds through the GitHub repository `lifeodyssey/share-html`. The production branch is `main`.

## Completed

- Built the Cloudflare Worker and React/Vite frontend.
- Added single-file HTML upload and share creation.
- Added public share pages at `/s/:slug`.
- Added direct preview pages at `/v/:slug/`.
- Added claim-token semantics for anonymous uploads.
- Added Supabase magic-link authentication.
- Added Worker-side Supabase Send Email Auth Hook handling for Cloudflare Email Service delivery.
- Added Supabase schema for profiles, shares, assets, reports, and events.
- Added Cloudflare R2 storage for private uploaded HTML objects.
- Added lightweight HTML risk scoring and moderation states.
- Added report and admin moderation API primitives.
- Added app logo, GitHub links, badges, and README polish.
- Added branded Supabase magic-link email template notes.
- Added Cloudflare custom domain `sharehtml.zhenjia.dev`.
- Added GitHub CI workflow:
  - `npm ci`
  - `npm test`
  - `npm run build`
  - `npx wrangler deploy --dry-run`
- Connected Cloudflare Workers Builds:
  - Git repo: `lifeodyssey/share-html`
  - Production branch: `main`
  - Build command: `npm run build`
  - Deploy command: `npx wrangler deploy`
  - Non-production branch builds: disabled
- Protected GitHub `main`:
  - required status check: `Build`
  - pull request required before updates land
  - administrators included
  - force pushes disabled
  - deletions disabled

## Verification

Local verification passed:

```bash
npm run build
npx wrangler deploy --dry-run
```

Live URL check passed:

```text
https://sharehtml.zhenjia.dev -> HTTP 200
```

## Known External Issue

On 2026-05-26, GitHub Actions had a Major Outage affecting workflow starts. During that outage:

- `gh run list` returned no workflow runs.
- `workflow_dispatch` returned HTTP 500.
- Cloudflare Build history did not show a new build yet because no new post-connection `main` merge/push event had triggered a build.

After GitHub Actions recovers, the next PR merge into `main` should exercise the full production path.

## Open Configuration Notes

- The Cloudflare build token exists on the Cloudflare side. Its displayed name appears reused from another project; this does not affect GitHub secrets, but it should be renamed or replaced with a dedicated `share-html` build token later.
- Production email sender target is `sharehtml@zhenjia.dev`; Cloudflare Email Service sender/domain verification and the Supabase Send Email Hook still need to be enabled externally. Setup notes are in `docs/email/auth-email-setup.md`.
