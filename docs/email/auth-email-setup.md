# Auth Email Setup

Share HTML keeps Supabase Auth as the identity system, but production auth email delivery should run through Cloudflare Email Service. The app still calls `supabase.auth.signInWithOtp(...)`; Supabase generates the auth token and calls a Worker endpoint, then the Worker sends the email from `Share HTML <sharehtml@zhenjia.dev>`.

## Production Flow

```text
Browser
  -> Supabase Auth signInWithOtp
  -> Supabase Send Email Auth Hook
  -> POST https://sharehtml.zhenjia.dev/api/auth/supabase/send-email
  -> Worker verifies Standard Webhooks signature
  -> Worker sends through Cloudflare Email Service
```

The hook endpoint is:

```text
POST /api/auth/supabase/send-email
```

## Cloudflare Email Service

Configure Cloudflare Email Service for `zhenjia.dev` and verify the sender address:

```text
Share HTML <sharehtml@zhenjia.dev>
```

The Worker binding is configured in `wrangler.jsonc`:

```jsonc
"send_email": [
  {
    "name": "AUTH_EMAIL",
    "allowed_sender_addresses": ["sharehtml@zhenjia.dev"]
  }
]
```

The allow-list matters: even if code changes, this Worker binding can only send from the approved Share HTML sender.

## Worker Secrets

Set the Supabase Auth Hook secret after generating it in the Supabase Dashboard:

```bash
printf '%s' 'v1,whsec_...' | npx wrangler secret put SUPABASE_SEND_EMAIL_HOOK_SECRET
```

Existing Worker secrets are still required:

```bash
printf '%s' '<legacy-anon-key>' | npx wrangler secret put SUPABASE_REST_KEY
printf '%s' '<worker-api-secret>' | npx wrangler secret put WORKER_API_SECRET
printf '%s' '<random-salt>' | npx wrangler secret put IP_HASH_SALT
```

## Supabase Hook Setup

In the Supabase Dashboard:

1. Open `Authentication -> Hooks`.
2. Create or edit the `Send Email` hook.
3. Choose the HTTPS hook type.
4. Set the hook URL to `https://sharehtml.zhenjia.dev/api/auth/supabase/send-email`.
5. Generate the hook secret and save it as `SUPABASE_SEND_EMAIL_HOOK_SECRET` in Cloudflare.
6. Keep the Email Provider enabled and enable the Auth Hook.
7. Send a test magic link and inspect the received headers for `From`, SPF, DKIM, and DMARC.

When the Email Provider and Send Email Hook are both enabled, Supabase calls the hook and does not use SMTP for the email delivery.

## Template Source

The production Worker renders the branded email in `src/worker/auth-email.ts`.

These files remain useful as a fallback or visual reference if the hook is disabled:

- Subject: [`supabase/email-templates/magic-link.subject.txt`](../../supabase/email-templates/magic-link.subject.txt)
- HTML: [`supabase/email-templates/magic-link.html`](../../supabase/email-templates/magic-link.html)
- Preview: [`docs/email/magic-link-preview.html`](./magic-link-preview.html)
- Supabase template helper: [`scripts/apply-supabase-magic-link-template.sh`](../../scripts/apply-supabase-magic-link-template.sh)

## Rollback

To roll back to Supabase-managed sending:

1. Disable the `Send Email` Auth Hook in Supabase.
2. Configure Supabase's Magic Link template and SMTP/default sender settings.
3. Leave the Worker endpoint in place; it will not be used while the hook is disabled.

Important: avoid link tracking or link rewriting for auth emails. Magic links are one-time URLs, and provider-side link rewriting can consume or break them.
