# Share HTML Roadmap

## Near Term

- Verify GitHub Actions recovery with a small PR.
- Confirm the full path after recovery:
  - PR opens
  - `Build` check passes
  - PR merges into `main`
  - Cloudflare Workers Builds starts
  - production deploy succeeds
- Rename or replace the Cloudflare build token so it is clearly dedicated to Share HTML.
- Configure Cloudflare Email Service sender/domain verification for `sharehtml@zhenjia.dev`.
- Enable the Supabase Send Email Auth Hook against `/api/auth/supabase/send-email`.
- Confirm Supabase Auth site URL, redirect allow list, and branded email template in production.

## Product UX

- Improve post-create feedback so users clearly see that a share was created.
- Make Share URL, Preview URL, and Claim Token meanings visible in the UI.
- Add one-click actions for:
  - opening the share page
  - opening the preview page
  - copying share URL
  - copying preview URL
  - copying claim token when present
- Add a dashboard view for signed-in users to list, open, and delete their shares.
- Add clearer expired/deleted/blocked states on public share pages.

## Security And Moderation

- Add stronger upload rate limits by user and IP hash.
- Add per-user quota tracking.
- Add admin UI for reviewing `needs_review` shares.
- Add better report triage states.
- Consider a separate preview origin if same-origin iframe risk becomes uncomfortable.
- Add CSP and sandbox regression tests for preview responses.

## Reliability And Operations

- Add smoke tests for:
  - home page
  - anonymous share creation
  - share page rendering
  - preview route rendering
  - signed-in dashboard basics
- Add a deployment smoke check after Cloudflare builds.
- Add structured Worker logs for share creation and preview failures.
- Add simple uptime monitoring for `https://sharehtml.zhenjia.dev`.
- Document recovery steps for manual `npm run deploy`.

## Later Ideas

- Password-protected shares.
- ZIP/static-site uploads.
- Per-share expiration controls.
- Share analytics for owners.
- Versioned shares.
- Optional custom slugs.
- Browser-side HTML editing before upload.
- Team or organization accounts.
