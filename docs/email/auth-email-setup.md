# Auth Email Setup

Share HTML uses Supabase Auth magic links. The app can request the email from the browser, but Supabase owns the email template and sender settings.

## Template

Use these files for the Magic Link email:

- Subject: [`supabase/email-templates/magic-link.subject.txt`](../../supabase/email-templates/magic-link.subject.txt)
- HTML: [`supabase/email-templates/magic-link.html`](../../supabase/email-templates/magic-link.html)
- Preview: [`docs/email/magic-link-preview.html`](./magic-link-preview.html)

In the Supabase Dashboard, open:

`Authentication -> Email Templates -> Magic Link`

Set:

- Subject: `Sign in to Share HTML`
- Body: paste the contents of `supabase/email-templates/magic-link.html`

The template uses Supabase's Go template variables:

- `{{ .ConfirmationURL }}` for the one-time sign-in link.
- `{{ .SiteURL }}` for the configured app URL.

## Apply With The Management API

If you have a Supabase personal access token, this repo includes a helper:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... ./scripts/apply-supabase-magic-link-template.sh
```

The script updates only the Magic Link subject and HTML body for project `hihvtuyweqxnsmqmegdt`.

## Sender Address

To send from `@zhenjia.dev`, configure Custom SMTP in Supabase Auth. Use this sender for Share HTML:

```text
Share HTML <sharehtml@zhenjia.dev>
```

Supabase's default email service cannot send arbitrary branded mail from `@zhenjia.dev`. You need an SMTP provider first, for example any provider that can verify `zhenjia.dev` and give SMTP credentials.

Typical setup:

1. Create the sender or domain in your SMTP provider.
2. Add the provider's DNS records for `zhenjia.dev`, usually SPF, DKIM, and optionally DMARC.
3. Wait for domain verification to pass.
4. In Supabase Dashboard, open `Authentication -> SMTP Settings`.
5. Enable Custom SMTP and enter the provider credentials.
6. Set the sender name and email to `Share HTML <sharehtml@zhenjia.dev>`.
7. Send a test magic link and inspect the `From`, `Return-Path`, SPF, DKIM, and DMARC results in the received email headers.

Important: disable click tracking in the email provider for auth emails. Supabase recommends avoiding provider link rewriting because magic links are one-time authentication URLs.

## Cloudflare Email Service Option

Cloudflare can own DNS for `zhenjia.dev` and can send mail for `sharehtml@zhenjia.dev` with Cloudflare Email Service, but it is not an SMTP server. That means it cannot be pasted directly into Supabase's Custom SMTP settings.

To use Cloudflare for auth email sending, use Supabase's Send Email Auth Hook instead:

1. Onboard `zhenjia.dev` in Cloudflare Email Sending.
2. Add Cloudflare's sender DNS records for bounce handling, SPF, DKIM, and DMARC.
3. Add a Cloudflare Worker endpoint or Supabase Edge Function for the Send Email hook.
4. Verify the hook signature from Supabase.
5. Send the Magic Link email through Cloudflare Email Service from `Share HTML <sharehtml@zhenjia.dev>`.
6. Enable the hook in `Authentication -> Hooks -> Send Email`.

This replaces Supabase's built-in email sending for auth messages. Supabase Custom SMTP remains the simpler path if you choose a provider with SMTP credentials.
