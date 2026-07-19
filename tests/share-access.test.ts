import assert from "node:assert/strict";
import { describe, test } from "vitest";

import type { ShareRecord } from "../src/shared/types.ts";
import {
  createMetadataGrant,
  createPreviewGrant,
  createShareAccessKey,
  hashShareAccessKey,
  metadataGrantCookie,
  metadataGrantCookieName,
  previewGrantCookie,
  previewGrantCookieName,
  readMetadataGrant,
  readPreviewGrant,
  verifyPreviewGrant,
  verifyMetadataGrant,
  verifyShareAccessKey,
} from "../src/worker/share-access.ts";

const env = {
  SHARE_ACCESS_PEPPER_V1: "test-only-access-pepper",
  PREVIEW_GRANT_SIGNING_KEY_V1: "test-only-grant-signing-key",
};
const grantCreatedAt = Date.parse("2026-07-19T00:00:00.000Z");

function privateShare(overrides: Partial<ShareRecord> = {}): ShareRecord {
  return {
    id: "share-1",
    slug: "alpha123",
    owner_user_id: "user-1",
    share_type: "single_html",
    title: "Private preview",
    description: null,
    entry_path: "index.html",
    r2_prefix: "shares/share-1",
    size_bytes: 123,
    content_hash: "content-hash",
    visibility: "private_link",
    access_key_hash: "a".repeat(64),
    access_key_version: 1,
    lifecycle_status: "active",
    moderation_status: "clean",
    risk_score: 0,
    risk_reasons: [],
    claim_token_hash: null,
    expires_at: null,
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

function alterBase64UrlCharacter(value: string): string {
  const last = value.at(-1);
  assert.ok(last);
  return `${value.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}

describe("share access keys", () => {
  test("generates a 32-byte base64url key in the exact accepted format", () => {
    const keys = new Set(Array.from({ length: 16 }, () => createShareAccessKey()));

    assert.equal(keys.size, 16, "generated keys should not repeat in this sample");
    for (const key of keys) {
      assert.match(key, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(key.includes("="), false, "base64url key must not include padding");
    }
  });

  test("verifies the correct key against its peppered hash", async () => {
    const accessKey = createShareAccessKey();
    const accessKeyHash = await hashShareAccessKey(accessKey, env);

    assert.match(accessKeyHash, /^[0-9a-f]{64}$/);
    assert.equal(await verifyShareAccessKey(accessKey, accessKeyHash, 1, env), true);
  });

  test("rejects a wrong, malformed, non-string, or unstored key", async () => {
    const accessKey = createShareAccessKey();
    const accessKeyHash = await hashShareAccessKey(accessKey, env);
    const wrongKey = createShareAccessKey();

    assert.equal(await verifyShareAccessKey(wrongKey, accessKeyHash, 1, env), false);
    assert.equal(await verifyShareAccessKey("too-short", accessKeyHash, 1, env), false);
    assert.equal(await verifyShareAccessKey({ accessKey }, accessKeyHash, 1, env), false);
    assert.equal(await verifyShareAccessKey(accessKey, null, 1, env), false);
    assert.equal(await verifyShareAccessKey(accessKey, accessKeyHash, 2, env), false);
  });

  test("fails closed when either versioned private-share secret is missing", async () => {
    const accessKey = createShareAccessKey();

    await assert.rejects(
      hashShareAccessKey(accessKey, { ...env, SHARE_ACCESS_PEPPER_V1: "" }),
      /SHARE_ACCESS_PEPPER_V1 and PREVIEW_GRANT_SIGNING_KEY_V1 must be configured/
    );
    await assert.rejects(
      hashShareAccessKey(accessKey, { ...env, PREVIEW_GRANT_SIGNING_KEY_V1: "" }),
      /SHARE_ACCESS_PEPPER_V1 and PREVIEW_GRANT_SIGNING_KEY_V1 must be configured/
    );
  });
});

describe("preview grants", () => {
  test("accepts an authentic, unexpired grant for the same share", async () => {
    const share = privateShare();
    const grant = await createPreviewGrant(share, env, grantCreatedAt);

    assert.match(grant, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const encodedPayload = grant.split(".")[0]
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(grant.split(".")[0].length / 4) * 4, "=");
    const payload = JSON.parse(atob(encodedPayload)) as Record<string, unknown>;
    assert.ok(!("accessKeyHash" in payload), "the database hash must not be disclosed in the cookie");
    assert.equal(await verifyPreviewGrant(grant, share, env, grantCreatedAt + 599_000), true);
  });

  test("rejects a grant whose signed payload or signature was tampered with", async () => {
    const share = privateShare();
    const grant = await createPreviewGrant(share, env, grantCreatedAt);
    const [payload, signature] = grant.split(".");

    assert.equal(
      await verifyPreviewGrant(`${alterBase64UrlCharacter(payload)}.${signature}`, share, env, grantCreatedAt),
      false
    );
    assert.equal(
      await verifyPreviewGrant(`${payload}.${alterBase64UrlCharacter(signature)}`, share, env, grantCreatedAt),
      false
    );
  });

  test("expires after ten minutes, including the exact expiry boundary", async () => {
    const share = privateShare();
    const grant = await createPreviewGrant(share, env, grantCreatedAt);

    assert.equal(await verifyPreviewGrant(grant, share, env, grantCreatedAt + 599_999), true);
    assert.equal(await verifyPreviewGrant(grant, share, env, grantCreatedAt + 600_000), false);
    assert.equal(await verifyPreviewGrant(grant, share, env, grantCreatedAt + 900_000), false);
  });

  test("cannot be reused for another share id or slug", async () => {
    const share = privateShare();
    const grant = await createPreviewGrant(share, env, grantCreatedAt);

    assert.equal(
      await verifyPreviewGrant(grant, privateShare({ id: "share-2" }), env, grantCreatedAt),
      false
    );
    assert.equal(
      await verifyPreviewGrant(grant, privateShare({ slug: "beta456" }), env, grantCreatedAt),
      false
    );
  });

  test("binds metadata and preview grants to separate audiences", async () => {
    const share = privateShare();
    const previewGrant = await createPreviewGrant(share, env, grantCreatedAt);
    const metadataGrant = await createMetadataGrant(share, env, grantCreatedAt);

    assert.equal(await verifyPreviewGrant(previewGrant, share, env, grantCreatedAt), true);
    assert.equal(await verifyMetadataGrant(metadataGrant, share, env, grantCreatedAt), true);
    assert.equal(await verifyMetadataGrant(previewGrant, share, env, grantCreatedAt), false);
    assert.equal(await verifyPreviewGrant(metadataGrant, share, env, grantCreatedAt), false);
  });

  test("is invalidated immediately when the access key hash rotates", async () => {
    const share = privateShare();
    const grant = await createPreviewGrant(share, env, grantCreatedAt);
    const rotatedShare = privateShare({ access_key_hash: "b".repeat(64) });

    assert.equal(await verifyPreviewGrant(grant, rotatedShare, env, grantCreatedAt), false);
  });

  test("rejects absent/malformed grants and refuses grants for public shares", async () => {
    const share = privateShare();

    assert.equal(await verifyPreviewGrant(null, share, env, grantCreatedAt), false);
    assert.equal(await verifyPreviewGrant("not-a-grant", share, env, grantCreatedAt), false);
    assert.equal(
      await verifyPreviewGrant("not.a.valid.grant", share, env, grantCreatedAt),
      false
    );
    await assert.rejects(
      createPreviewGrant(
        privateShare({
          visibility: "public_unlisted",
          access_key_hash: null,
          access_key_version: null,
        }),
        env,
        grantCreatedAt
      ),
      /only be created for a private share/
    );
  });
});

describe("preview grant cookie", () => {
  test("is path-scoped, short-lived, HttpOnly, Secure, strict SameSite, and host-only", () => {
    const cookie = previewGrantCookie(
      "alpha123",
      "signed.preview-grant",
      new Request("https://sharehtml.zhenjia.dev/api/shares/alpha123/access")
    );

    assert.equal(previewGrantCookieName("alpha123"), "share_access_alpha123");
    assert.match(cookie, /^share_access_alpha123=signed\.preview-grant;/);
    assert.match(cookie, /(?:^|; )Path=\/v\/alpha123(?:;|$)/);
    assert.match(cookie, /(?:^|; )Max-Age=600(?:;|$)/);
    assert.match(cookie, /(?:^|; )HttpOnly(?:;|$)/);
    assert.match(cookie, /(?:^|; )Secure(?:;|$)/);
    assert.match(cookie, /(?:^|; )SameSite=Strict(?:;|$)/);
    assert.doesNotMatch(cookie, /(?:^|; )Domain=/i);
  });

  test("parses its exact cookie among unrelated cookies", () => {
    const request = new Request("https://sharehtml.zhenjia.dev/v/alpha123/", {
      headers: {
        cookie: "theme=dark; share_access_other=wrong; share_access_alpha123=payload.signature; session=abc",
      },
    });

    assert.equal(readPreviewGrant(request, "alpha123"), "payload.signature");
    assert.equal(readPreviewGrant(request, "other"), "wrong");
    assert.equal(readPreviewGrant(request, "missing"), null);
  });

  test("returns null for an empty cookie value", () => {
    const request = new Request("https://sharehtml.zhenjia.dev/v/alpha123/", {
      headers: { cookie: "share_access_alpha123=" },
    });

    assert.equal(readPreviewGrant(request, "alpha123"), null);
  });

  test("uses a separate host-only cookie scoped only to metadata recovery", () => {
    const cookie = metadataGrantCookie(
      "alpha123",
      "signed.preview-grant",
      new Request("https://sharehtml.zhenjia.dev/api/shares/alpha123/access")
    );

    assert.equal(metadataGrantCookieName("alpha123"), "share_metadata_alpha123");
    assert.match(cookie, /^share_metadata_alpha123=signed\.preview-grant;/);
    assert.match(cookie, /(?:^|; )Path=\/api\/shares\/alpha123\/access(?:;|$)/);
    assert.match(cookie, /(?:^|; )Max-Age=600(?:;|$)/);
    assert.match(cookie, /(?:^|; )HttpOnly(?:;|$)/);
    assert.match(cookie, /(?:^|; )Secure(?:;|$)/);
    assert.match(cookie, /(?:^|; )SameSite=Strict(?:;|$)/);
    assert.doesNotMatch(cookie, /(?:^|; )Domain=/i);

    const request = new Request("https://sharehtml.zhenjia.dev/api/shares/alpha123/access", {
      headers: { cookie: "share_metadata_alpha123=payload.signature" },
    });
    assert.equal(readMetadataGrant(request, "alpha123"), "payload.signature");
    assert.equal(readPreviewGrant(request, "alpha123"), null);
  });
});
