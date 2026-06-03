export type SupabaseEmailData = {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new?: string;
  token_hash_new?: string;
};

export type SupabaseSendEmailPayload = {
  user: {
    email?: string;
    new_email?: string;
  };
  email_data: SupabaseEmailData;
};

export type AuthEmailConfig = {
  appOrigin: string;
  fromAddress: string;
  fromName: string;
  supabaseUrl: string;
};

export type AuthEmailMessagePlan = {
  to: string;
  from: string;
  fromAddress: string;
  fromName: string;
  subject: string;
  html: string;
  text: string;
};

type StandardWebhookVerification = {
  rawBody: string;
  secret: string;
  headers: Headers;
  nowSeconds?: number;
  toleranceSeconds?: number;
};

const DEFAULT_FROM_ADDRESS = "sharehtml@zhenjia.dev";
const DEFAULT_FROM_NAME = "Share HTML";
const DEFAULT_SUBJECT = "Sign in to Share HTML";
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export function parseSupabaseSendEmailPayload(rawBody: string): SupabaseSendEmailPayload {
  const parsed = JSON.parse(rawBody) as Partial<SupabaseSendEmailPayload>;
  const emailData = parsed.email_data;

  if (!parsed.user || typeof parsed.user !== "object") {
    throw new Error("Missing Supabase hook user.");
  }
  if (!emailData || typeof emailData !== "object") {
    throw new Error("Missing Supabase hook email_data.");
  }
  if (!parsed.user.email && !parsed.user.new_email) {
    throw new Error("Missing recipient email.");
  }
  if (!emailData.token_hash || !emailData.email_action_type) {
    throw new Error("Missing Supabase email token data.");
  }

  return {
    user: {
      email: parsed.user.email,
      new_email: parsed.user.new_email
    },
    email_data: {
      token: emailData.token ?? "",
      token_hash: emailData.token_hash,
      redirect_to: emailData.redirect_to,
      email_action_type: emailData.email_action_type,
      site_url: emailData.site_url,
      token_new: emailData.token_new ?? "",
      token_hash_new: emailData.token_hash_new ?? ""
    }
  };
}

export function buildAuthEmailPlan(payload: SupabaseSendEmailPayload, config: Partial<AuthEmailConfig> & Pick<AuthEmailConfig, "supabaseUrl">): AuthEmailMessagePlan[] {
  const fromAddress = config.fromAddress ?? DEFAULT_FROM_ADDRESS;
  const fromName = config.fromName ?? DEFAULT_FROM_NAME;
  const appOrigin = config.appOrigin ?? payload.email_data.site_url;
  const baseConfig = { appOrigin, fromAddress, fromName, supabaseUrl: config.supabaseUrl };

  if (payload.email_data.email_action_type === "email_change" && payload.user.email && payload.user.new_email && payload.email_data.token_hash_new) {
    return [
      buildSingleAuthEmailPlan(payload.user.email, {
        ...payload.email_data,
        token_hash: payload.email_data.token_hash_new,
        token: payload.email_data.token
      }, baseConfig),
      buildSingleAuthEmailPlan(payload.user.new_email, {
        ...payload.email_data,
        token_hash: payload.email_data.token_hash,
        token: payload.email_data.token_new || payload.email_data.token
      }, baseConfig)
    ];
  }

  return [buildSingleAuthEmailPlan(selectRecipient(payload), payload.email_data, baseConfig)];
}

function buildSingleAuthEmailPlan(to: string, emailData: SupabaseEmailData, config: AuthEmailConfig): AuthEmailMessagePlan {
  const confirmationUrl = buildSupabaseConfirmationUrl(config.supabaseUrl, emailData);

  return {
    to,
    from: `${config.fromName} <${config.fromAddress}>`,
    fromAddress: config.fromAddress,
    fromName: config.fromName,
    subject: DEFAULT_SUBJECT,
    html: renderAuthEmailHtml({
      appOrigin: config.appOrigin,
      confirmationUrl,
      siteUrl: emailData.site_url || config.appOrigin,
      token: emailData.token,
      actionType: emailData.email_action_type
    }),
    text: renderAuthEmailText({
      confirmationUrl,
      token: emailData.token,
      siteUrl: emailData.site_url || config.appOrigin
    })
  };
}

export function buildSupabaseConfirmationUrl(supabaseUrl: string, emailData: SupabaseEmailData): string {
  const url = new URL("/auth/v1/verify", normalizedOrigin(supabaseUrl));
  url.searchParams.set("token", emailData.token_hash);
  url.searchParams.set("type", emailData.email_action_type);
  if (emailData.redirect_to) {
    url.searchParams.set("redirect_to", emailData.redirect_to);
  }
  return url.toString();
}

export async function verifyStandardWebhookSignature({
  rawBody,
  secret,
  headers,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS
}: StandardWebhookVerification): Promise<boolean> {
  const webhookId = headers.get("webhook-id");
  const webhookTimestamp = headers.get("webhook-timestamp");
  const webhookSignature = headers.get("webhook-signature");
  if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

  const timestamp = Number(webhookTimestamp);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const signatures = parseSignatureHeader(webhookSignature);
  if (signatures.length === 0) return false;

  for (const keyBytes of decodeHookSecrets(secret)) {
    const expected = await hmacSha256(keyBytes, signedContent);
    for (const signature of signatures) {
      if (timingSafeEqual(expected, signature)) return true;
    }
  }

  return false;
}

export function buildMimeMessage(plan: AuthEmailMessagePlan): string {
  const boundary = "share-html-auth-email-boundary";
  return [
    `From: ${sanitizeHeader(plan.from)}`,
    `To: ${sanitizeHeader(plan.to)}`,
    `Subject: ${sanitizeHeader(plan.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plan.text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plan.html,
    "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

function selectRecipient(payload: SupabaseSendEmailPayload): string {
  if (payload.email_data.email_action_type === "email_change" && payload.user.new_email) {
    return payload.user.new_email;
  }
  if (payload.user.email) return payload.user.email;
  if (payload.user.new_email) return payload.user.new_email;
  throw new Error("Missing recipient email.");
}

function renderAuthEmailHtml({ appOrigin, confirmationUrl, siteUrl, token, actionType }: {
  appOrigin: string;
  confirmationUrl: string;
  siteUrl: string;
  token: string;
  actionType: string;
}): string {
  const safeConfirmationUrl = escapeHtml(confirmationUrl);
  const safeSiteUrl = escapeHtml(siteUrl);
  const safeToken = escapeHtml(token);
  const preheader = actionType === "recovery"
    ? "Reset access to your Share HTML account."
    : "Use this one-time link to sign in to Share HTML.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in to Share HTML</title>
  </head>
  <body style="margin:0; padding:0; background:#f4f1e8; color:#26322f; font-family:Avenir Next, Segoe UI, Arial, sans-serif;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1e8; background-image:linear-gradient(90deg, rgba(38,50,47,0.06) 1px, transparent 1px), linear-gradient(0deg, rgba(38,50,47,0.05) 1px, transparent 1px); background-size:32px 32px;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px; border:2px solid #26322f; border-radius:10px; background:#fff9ec; box-shadow:8px 8px 0 #26322f;">
            <tr>
              <td style="padding:28px 28px 14px;">
                <table role="presentation" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="44" height="44" align="center" style="border:2px solid #26322f; border-radius:8px; background:#fffefa; font-weight:800; font-size:17px; color:#2d6241;">
                      &lt;/&gt;
                    </td>
                    <td style="padding-left:12px; font-weight:800; font-size:18px; color:#26322f;">
                      Share HTML
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:6px 28px 0;">
                <p style="margin:0 0 10px; color:#846428; font-size:12px; font-weight:800; text-transform:uppercase;">
                  Magic sign-in link
                </p>
                <h1 style="margin:0; font-size:34px; line-height:1.08; letter-spacing:0; color:#26322f;">
                  Sign in to keep your HTML shares.
                </h1>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 28px 0;">
                <p style="margin:0; color:#4d5b55; font-size:16px; line-height:1.55;">
                  Use this one-time link to sign in to Share HTML. It lets you keep uploaded pages, delete them later, and claim anonymous uploads.
                </p>
              </td>
            </tr>

            <tr>
              <td align="left" style="padding:26px 28px 12px;">
                <a href="${safeConfirmationUrl}" style="display:inline-block; border:2px solid #26322f; border-radius:7px; background:#e85d3f; color:#fff8eb; font-size:16px; font-weight:800; text-decoration:none; padding:13px 20px;">
                  Sign in to Share HTML
                </a>
              </td>
            </tr>

            <tr>
              <td style="padding:8px 28px 0;">
                <p style="margin:0; color:#657069; font-size:13px; line-height:1.5;">
                  If the button does not work, copy this link into your browser:
                </p>
                <p style="margin:8px 0 0; word-break:break-all; color:#2d6241; font-size:13px; line-height:1.45;">
                  ${safeConfirmationUrl}
                </p>
                ${safeToken ? `<p style="margin:14px 0 0; color:#657069; font-size:13px; line-height:1.5;">One-time code: <strong style="color:#26322f;">${safeToken}</strong></p>` : ""}
              </td>
            </tr>

            <tr>
              <td style="padding:22px 28px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid rgba(38,50,47,0.18);">
                  <tr>
                    <td style="padding-top:16px; color:#657069; font-size:12px; line-height:1.5;">
                      This link only signs you in. It does not publish, edit, or share any HTML by itself. You can ignore this email if you did not request it.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding-top:10px; color:#657069; font-size:12px; line-height:1.5;">
                      Sent for <a href="${escapeHtml(appOrigin)}" style="color:#2d6241;">${safeSiteUrl}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderAuthEmailText({ confirmationUrl, token, siteUrl }: { confirmationUrl: string; token: string; siteUrl: string }): string {
  return [
    "Sign in to Share HTML",
    "",
    "Use this one-time link to sign in:",
    confirmationUrl,
    "",
    token ? `One-time code: ${token}` : "",
    token ? "" : null,
    "This link only signs you in. It does not publish, edit, or share any HTML by itself.",
    `Sent for ${siteUrl}`
  ].filter((line): line is string => line !== null).join("\n");
}

function normalizedOrigin(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseSignatureHeader(value: string): Uint8Array[] {
  const signatures: Uint8Array[] = [];
  for (const part of value.split(/\s+/)) {
    const [, encoded] = part.split(",", 2);
    if (!encoded) continue;
    try {
      signatures.push(fromBase64(encoded));
    } catch {
      continue;
    }
  }
  return signatures;
}

function decodeHookSecrets(value: string): Uint8Array[] {
  return value.split("|").map((part) => {
    const trimmed = part.trim();
    const encoded = trimmed.includes("whsec_") ? trimmed.split("whsec_")[1] : trimmed;
    return fromBase64(encoded);
  });
}

async function hmacSha256(keyBytes: Uint8Array, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function timingSafeEqual(expected: Uint8Array, actual: Uint8Array): boolean {
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected[index] ^ actual[index];
  }
  return diff === 0;
}

function fromBase64(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      default: return "&#039;";
    }
  });
}
