import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthEmailPlan,
  buildSupabaseConfirmationUrl,
  verifyStandardWebhookSignature
} from "../src/worker/auth-email.ts";

const samplePayload = {
  user: {
    email: "lumi@example.com"
  },
  email_data: {
    token: "123456",
    token_hash: "hash-abc",
    redirect_to: "https://sharehtml.zhenjia.dev/?next=/dashboard",
    email_action_type: "magiclink",
    site_url: "https://sharehtml.zhenjia.dev",
    token_new: "",
    token_hash_new: ""
  }
};

test("buildSupabaseConfirmationUrl encodes the Supabase verify link", () => {
  const url = buildSupabaseConfirmationUrl(
    "https://hihvtuyweqxnsmqmegdt.supabase.co",
    samplePayload.email_data
  );

  assert.equal(
    url,
    "https://hihvtuyweqxnsmqmegdt.supabase.co/auth/v1/verify?token=hash-abc&type=magiclink&redirect_to=https%3A%2F%2Fsharehtml.zhenjia.dev%2F%3Fnext%3D%2Fdashboard"
  );
});

test("buildAuthEmailPlan renders a branded login email from hook payload", () => {
  const [message] = buildAuthEmailPlan(samplePayload, {
    appOrigin: "https://sharehtml.zhenjia.dev",
    fromAddress: "sharehtml@zhenjia.dev",
    fromName: "Share HTML",
    supabaseUrl: "https://hihvtuyweqxnsmqmegdt.supabase.co"
  });

  assert.equal(message.to, "lumi@example.com");
  assert.equal(message.from, "Share HTML <sharehtml@zhenjia.dev>");
  assert.equal(message.subject, "Sign in to Share HTML");
  assert.match(message.html, /Sign in to Share HTML/);
  assert.match(message.html, /hash-abc/);
  assert.match(message.text, /123456/);
  assert.doesNotMatch(message.html, /\{\{ \.ConfirmationURL \}\}/);
});

test("buildAuthEmailPlan sends both messages for secure email changes", () => {
  const messages = buildAuthEmailPlan({
    user: {
      email: "current@example.com",
      new_email: "new@example.com"
    },
    email_data: {
      token: "111111",
      token_hash: "hash-new",
      redirect_to: "https://sharehtml.zhenjia.dev/settings",
      email_action_type: "email_change",
      site_url: "https://sharehtml.zhenjia.dev",
      token_new: "222222",
      token_hash_new: "hash-current"
    }
  }, {
    appOrigin: "https://sharehtml.zhenjia.dev",
    fromAddress: "sharehtml@zhenjia.dev",
    fromName: "Share HTML",
    supabaseUrl: "https://hihvtuyweqxnsmqmegdt.supabase.co"
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].to, "current@example.com");
  assert.match(messages[0].html, /hash-current/);
  assert.match(messages[0].text, /111111/);
  assert.equal(messages[1].to, "new@example.com");
  assert.match(messages[1].html, /hash-new/);
  assert.match(messages[1].text, /222222/);
});

test("verifyStandardWebhookSignature accepts valid Standard Webhooks signatures", async () => {
  const rawBody = JSON.stringify(samplePayload);
  const secret = "v1,whsec_" + toBase64(new TextEncoder().encode("test-secret"));
  const timestamp = "1700000000";
  const id = "msg_test";
  const signature = await signStandardWebhook(secret, id, timestamp, rawBody);

  const verified = await verifyStandardWebhookSignature({
    rawBody,
    secret,
    headers: new Headers({
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`
    }),
    nowSeconds: 1700000001
  });

  assert.equal(verified, true);
});

test("verifyStandardWebhookSignature rejects tampered payloads", async () => {
  const rawBody = JSON.stringify(samplePayload);
  const secret = "v1,whsec_" + toBase64(new TextEncoder().encode("test-secret"));
  const timestamp = "1700000000";
  const id = "msg_test";
  const signature = await signStandardWebhook(secret, id, timestamp, rawBody);

  const verified = await verifyStandardWebhookSignature({
    rawBody: rawBody.replace("lumi@example.com", "attacker@example.com"),
    secret,
    headers: new Headers({
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`
    }),
    nowSeconds: 1700000001
  });

  assert.equal(verified, false);
});

async function signStandardWebhook(secret: string, id: string, timestamp: string, rawBody: string): Promise<string> {
  const keyBytes = decodeHookSecret(secret)[0];
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return toBase64(new Uint8Array(signature));
}

function decodeHookSecret(secret: string): Uint8Array[] {
  return secret.split("|").map((part) => {
    const trimmed = part.trim();
    const encoded = trimmed.includes("whsec_") ? trimmed.split("whsec_")[1] : trimmed;
    return fromBase64(encoded);
  });
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}
