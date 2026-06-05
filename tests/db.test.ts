import assert from "node:assert/strict";
import { test, afterEach, vi } from "vitest";

import {
  getShareBySlug,
  logShareEvent,
  createUniqueSlug,
  toPublicShare,
  randomSlug,
  createSecretToken,
  requireWorkerDatabaseAccess,
  // Intent functions
  countRecentUploadsByIp,
  countRecentUploadsByUser,
  insertShare,
  insertShareAsset,
  updateShareScanResult,
  findUserShares,
  insertReport,
  getOpenReports,
  findClaimableShare,
  claimShareRow,
  softDeleteShare,
  setShareModeration,
  getUserProfile,
  insertUserProfile,
} from "../src/worker/db.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_REST_KEY: "anon-key",
    WORKER_API_SECRET: "worker-secret",
    SUPABASE_PUBLISHABLE_KEY: "pub-key",
    ...overrides,
  } as any;
}

function supabaseOk(rows: unknown = []) {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// requireWorkerDatabaseAccess
// ---------------------------------------------------------------------------

test("requireWorkerDatabaseAccess: throws when SUPABASE_REST_KEY is missing", () => {
  const env = makeEnv({ SUPABASE_REST_KEY: "" });
  assert.throws(
    () => requireWorkerDatabaseAccess(env),
    /SUPABASE_REST_KEY and WORKER_API_SECRET must be configured/
  );
});

test("requireWorkerDatabaseAccess: throws when WORKER_API_SECRET is missing", () => {
  const env = makeEnv({ WORKER_API_SECRET: "" });
  assert.throws(
    () => requireWorkerDatabaseAccess(env),
    /SUPABASE_REST_KEY and WORKER_API_SECRET must be configured/
  );
});

test("requireWorkerDatabaseAccess: does not throw when both secrets are present", () => {
  const env = makeEnv();
  assert.doesNotThrow(() => requireWorkerDatabaseAccess(env));
});

// ---------------------------------------------------------------------------
// getShareBySlug
// ---------------------------------------------------------------------------

test("getShareBySlug: requests shares?select=*&slug=eq.<slug>&limit=1", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([{ id: "s1", slug: "abc" }]);
  });

  const env = makeEnv();
  await getShareBySlug(env, "abc");

  assert.equal(
    capturedUrl,
    "https://proj.supabase.co/rest/v1/shares?select=*&slug=eq.abc&limit=1"
  );
});

test("getShareBySlug: returns the first row when found", async () => {
  const fakeShare = { id: "s1", slug: "abc", title: "Test" };
  vi.stubGlobal("fetch", async () => supabaseOk([fakeShare]));

  const env = makeEnv();
  const result = await getShareBySlug(env, "abc");

  assert.deepEqual(result, fakeShare);
});

test("getShareBySlug: returns null when no rows returned", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));

  const env = makeEnv();
  const result = await getShareBySlug(env, "notfound");

  assert.equal(result, null);
});

test("getShareBySlug: URL-encodes the slug", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([]);
  });

  const env = makeEnv();
  await getShareBySlug(env, "a b+c");

  // encodeURIComponent("a b+c") === "a%20b%2Bc"
  assert.ok(capturedUrl!.includes("slug=eq.a%20b%2Bc"), `URL was: ${capturedUrl}`);
});

// ---------------------------------------------------------------------------
// logShareEvent
// ---------------------------------------------------------------------------

test("logShareEvent: inserts into share_events table", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([{}]);
  });

  const env = makeEnv();
  await logShareEvent(env, "share-1", "user-1", "created", "iphash", "uahash", { risk_score: 0 });

  assert.ok(capturedUrl!.includes("/rest/v1/share_events"), `URL was: ${capturedUrl}`);
});

test("logShareEvent: sends correct fields in body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return supabaseOk([{}]);
  });

  const env = makeEnv();
  await logShareEvent(env, "share-1", "user-1", "viewed", "iphash", "uahash", { risk_score: 5 });

  assert.equal(capturedBody!["share_id"], "share-1");
  assert.equal(capturedBody!["actor_user_id"], "user-1");
  assert.equal(capturedBody!["event_type"], "viewed");
  assert.equal(capturedBody!["ip_hash"], "iphash");
  assert.equal(capturedBody!["user_agent_hash"], "uahash");
  assert.deepEqual(capturedBody!["metadata"], { risk_score: 5 });
});

test("logShareEvent: accepts null actor, ip, and uaHash", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return supabaseOk([{}]);
  });

  const env = makeEnv();
  await logShareEvent(env, "share-2", null, "deleted", null, null, {});

  assert.equal(capturedBody!["actor_user_id"], null);
  assert.equal(capturedBody!["ip_hash"], null);
  assert.equal(capturedBody!["user_agent_hash"], null);
});

// ---------------------------------------------------------------------------
// toPublicShare
// ---------------------------------------------------------------------------

function makeShareRecord(overrides: Record<string, unknown> = {}): any {
  return {
    id: "share-uuid",
    slug: "TestSlug",
    owner_user_id: null,
    title: "Test Title",
    lifecycle_status: "active",
    moderation_status: "clean",
    risk_score: 0,
    risk_reasons: [],
    expires_at: null,
    created_at: "2024-01-01T00:00:00.000Z",
    size_bytes: 1024,
    content_hash: "abc123",
    deleted_at: null,
    r2_prefix: "shares/share-uuid/",
    entry_path: "index.html",
    ...overrides,
  };
}

test("toPublicShare: id field matches share.id", () => {
  const share = makeShareRecord({ id: "uuid-123" });
  const req = new Request("https://app.example.com/");
  const env = makeEnv();
  const result = toPublicShare(share, req, env);
  assert.equal(result.id, "uuid-123");
});

test("toPublicShare: slug field matches share.slug", () => {
  const share = makeShareRecord({ slug: "myslug" });
  const req = new Request("https://app.example.com/");
  const result = toPublicShare(share, req, makeEnv());
  assert.equal(result.slug, "myslug");
});

test("toPublicShare: title field matches share.title", () => {
  const share = makeShareRecord({ title: "My Page" });
  const req = new Request("https://app.example.com/");
  const result = toPublicShare(share, req, makeEnv());
  assert.equal(result.title, "My Page");
});

test("toPublicShare: lifecycle_status matches share.lifecycle_status", () => {
  const share = makeShareRecord({ lifecycle_status: "blocked" });
  const req = new Request("https://app.example.com/");
  const result = toPublicShare(share, req, makeEnv());
  assert.equal(result.lifecycle_status, "blocked");
});

test("toPublicShare: moderation_status matches share.moderation_status", () => {
  const share = makeShareRecord({ moderation_status: "suspicious" });
  const req = new Request("https://app.example.com/");
  const result = toPublicShare(share, req, makeEnv());
  assert.equal(result.moderation_status, "suspicious");
});

test("toPublicShare: share_url uses APP_ORIGIN env when set", () => {
  const share = makeShareRecord({ slug: "myslug" });
  const req = new Request("https://app.example.com/");
  const env = makeEnv({ APP_ORIGIN: "https://custom-app.example.com" });
  const result = toPublicShare(share, req, env);
  assert.equal(result.share_url, "https://custom-app.example.com/s/myslug");
});

test("toPublicShare: share_url falls back to request origin when APP_ORIGIN not set", () => {
  const share = makeShareRecord({ slug: "myslug" });
  const req = new Request("https://request.example.com/some/path");
  const env = makeEnv({ APP_ORIGIN: undefined });
  const result = toPublicShare(share, req, env);
  assert.equal(result.share_url, "https://request.example.com/s/myslug");
});

test("toPublicShare: preview_url uses PREVIEW_ORIGIN env when set", () => {
  const share = makeShareRecord({ slug: "myslug" });
  const req = new Request("https://app.example.com/");
  const env = makeEnv({ PREVIEW_ORIGIN: "https://preview.example.com" });
  const result = toPublicShare(share, req, env);
  assert.equal(result.preview_url, "https://preview.example.com/v/myslug/");
});

test("toPublicShare: preview_url falls back to request origin when PREVIEW_ORIGIN not set", () => {
  const share = makeShareRecord({ slug: "myslug" });
  const req = new Request("https://request.example.com/");
  const env = makeEnv({ PREVIEW_ORIGIN: undefined });
  const result = toPublicShare(share, req, env);
  assert.equal(result.preview_url, "https://request.example.com/v/myslug/");
});

test("toPublicShare: expires_at, created_at, size_bytes, owner_user_id are passed through", () => {
  const share = makeShareRecord({
    expires_at: "2025-01-01T00:00:00.000Z",
    created_at: "2024-06-01T00:00:00.000Z",
    size_bytes: 2048,
    owner_user_id: "user-abc",
  });
  const req = new Request("https://app.example.com/");
  const result = toPublicShare(share, req, makeEnv());
  assert.equal(result.expires_at, "2025-01-01T00:00:00.000Z");
  assert.equal(result.created_at, "2024-06-01T00:00:00.000Z");
  assert.equal(result.size_bytes, 2048);
  assert.equal(result.owner_user_id, "user-abc");
});

test("toPublicShare: risk_score and risk_reasons are passed through", () => {
  const share = makeShareRecord({
    risk_score: 7,
    risk_reasons: [{ code: "external_script", weight: 3, detail: "loaded from cdn" }],
  });
  const req = new Request("https://app.example.com/");
  const result = toPublicShare(share, req, makeEnv());
  assert.equal(result.risk_score, 7);
  assert.deepEqual(result.risk_reasons, [{ code: "external_script", weight: 3, detail: "loaded from cdn" }]);
});

// ---------------------------------------------------------------------------
// randomSlug
// ---------------------------------------------------------------------------

const EXPECTED_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

test("randomSlug: returns string of requested length", () => {
  const slug = randomSlug(10);
  assert.equal(slug.length, 10);
});

test("randomSlug: length=1 returns single character", () => {
  const slug = randomSlug(1);
  assert.equal(slug.length, 1);
});

test("randomSlug: all characters are from SLUG_ALPHABET", () => {
  const alphabetSet = new Set(EXPECTED_ALPHABET);
  for (let i = 0; i < 20; i++) {
    const slug = randomSlug(20);
    for (const ch of slug) {
      assert.ok(alphabetSet.has(ch), `unexpected char '${ch}' in slug '${slug}'`);
    }
  }
});

test("randomSlug: returns different values on repeated calls (probabilistic)", () => {
  const slugs = new Set(Array.from({ length: 10 }, () => randomSlug(10)));
  assert.ok(slugs.size > 1, "expected multiple distinct slugs");
});

// ---------------------------------------------------------------------------
// createSecretToken
// ---------------------------------------------------------------------------

test("createSecretToken: returns a string", () => {
  const token = createSecretToken();
  assert.equal(typeof token, "string");
});

test("createSecretToken: token length is 32 characters (24 bytes base64url-encoded without padding)", () => {
  const token = createSecretToken();
  assert.equal(token.length, 32);
});

test("createSecretToken: token contains only base64url characters (A-Z, a-z, 0-9, -, _)", () => {
  for (let i = 0; i < 10; i++) {
    const token = createSecretToken();
    assert.match(token, /^[A-Za-z0-9\-_]+$/, `token '${token}' contains unexpected chars`);
  }
});

test("createSecretToken: returns different values on repeated calls (probabilistic)", () => {
  const tokens = new Set(Array.from({ length: 5 }, () => createSecretToken()));
  assert.ok(tokens.size > 1, "expected multiple distinct tokens");
});

// ---------------------------------------------------------------------------
// createUniqueSlug
// ---------------------------------------------------------------------------

test("createUniqueSlug: returns a string", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));

  const env = makeEnv();
  const slug = await createUniqueSlug(env);
  assert.equal(typeof slug, "string");
});

test("createUniqueSlug: returns a slug of length 10 when first attempt is unique", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));

  const env = makeEnv();
  const slug = await createUniqueSlug(env);
  assert.equal(slug.length, 10);
});

test("createUniqueSlug: retries until a unique slug is found", async () => {
  let callCount = 0;
  vi.stubGlobal("fetch", async () => {
    callCount++;
    const rows = callCount < 4 ? [{ id: "existing" }] : [];
    return supabaseOk(rows);
  });

  const env = makeEnv();
  const slug = await createUniqueSlug(env);
  assert.equal(typeof slug, "string");
  assert.ok(slug.length >= 10, `slug length was ${slug.length}`);
  assert.equal(callCount, 4);
});

test("createUniqueSlug: appends Date.now base36 when all 6 attempts collide", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([{ id: "existing" }]));

  const env = makeEnv();
  const slug = await createUniqueSlug(env);
  assert.ok(slug.length > 10, `expected length > 10, got ${slug.length}`);
});

// ---------------------------------------------------------------------------
// countRecentUploadsByIp
// ---------------------------------------------------------------------------

test("countRecentUploadsByIp: issues GET request to shares with correct filter params", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([]);
  });

  const env = makeEnv();
  await countRecentUploadsByIp(env, "ip-hash-abc", "2024-01-01T00:00:00.000Z", 10);

  assert.ok(capturedUrl!.includes("creator_ip_hash=eq.ip-hash-abc"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("created_at=gte."), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("limit=11"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("shares?select=id"), `URL: ${capturedUrl}`);
});

test("countRecentUploadsByIp: returns the row count from the response", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([{ id: "a" }, { id: "b" }, { id: "c" }]));

  const env = makeEnv();
  const count = await countRecentUploadsByIp(env, "hash", "2024-01-01T00:00:00.000Z", 10);
  assert.equal(count, 3);
});

test("countRecentUploadsByIp: URL-encodes ipHash and sinceIso", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([]);
  });

  const env = makeEnv();
  await countRecentUploadsByIp(env, "hash with space", "2024-01-01T00:00:00.000Z", 5);

  assert.ok(capturedUrl!.includes("creator_ip_hash=eq.hash%20with%20space"), `URL: ${capturedUrl}`);
});

test("countRecentUploadsByIp: cap is reflected as limit=cap+1 in the URL", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([]);
  });

  const env = makeEnv();
  await countRecentUploadsByIp(env, "hash", "2024-01-01T00:00:00.000Z", 5);

  assert.ok(capturedUrl!.includes("limit=6"), `URL: ${capturedUrl}`);
});

// ---------------------------------------------------------------------------
// countRecentUploadsByUser
// ---------------------------------------------------------------------------

test("countRecentUploadsByUser: issues GET request to shares with correct user filter", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([]);
  });

  const env = makeEnv();
  await countRecentUploadsByUser(env, "user-xyz", "2024-01-01T00:00:00.000Z", 100);

  assert.ok(capturedUrl!.includes("owner_user_id=eq.user-xyz"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("created_at=gte."), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("limit=101"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("shares?select=id"), `URL: ${capturedUrl}`);
});

test("countRecentUploadsByUser: returns the row count from the response", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk(new Array(50).fill({ id: "x" })));

  const env = makeEnv();
  const count = await countRecentUploadsByUser(env, "user-1", "2024-01-01T00:00:00.000Z", 100);
  assert.equal(count, 50);
});

test("countRecentUploadsByUser: cap is reflected as limit=cap+1 in the URL", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([]);
  });

  const env = makeEnv();
  await countRecentUploadsByUser(env, "user-1", "2024-01-01T00:00:00.000Z", 7);

  assert.ok(capturedUrl!.includes("limit=8"), `URL: ${capturedUrl}`);
});

// ---------------------------------------------------------------------------
// insertShare
// ---------------------------------------------------------------------------

test("insertShare: POSTs to shares?select=*", async () => {
  let capturedUrl: string | undefined;
  let capturedMethod: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown, init: RequestInit) => {
    capturedUrl = String(url);
    capturedMethod = init.method;
    return supabaseOk([{ id: "new-share" }]);
  });

  const env = makeEnv();
  await insertShare(env, { id: "new-share", slug: "abc123" });

  assert.equal(capturedMethod, "POST");
  assert.ok(capturedUrl!.includes("/rest/v1/shares?select=*"), `URL: ${capturedUrl}`);
});

test("insertShare: sends the fields as JSON body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return supabaseOk([{ id: "s1" }]);
  });

  const env = makeEnv();
  await insertShare(env, { id: "s1", slug: "xyz", lifecycle_status: "uploading" });

  assert.equal(capturedBody!.id, "s1");
  assert.equal(capturedBody!.slug, "xyz");
  assert.equal(capturedBody!.lifecycle_status, "uploading");
});

test("insertShare: returns the inserted share row", async () => {
  const shareRow = { id: "s1", slug: "abc", lifecycle_status: "uploading" };
  vi.stubGlobal("fetch", async () => supabaseOk([shareRow]));

  const env = makeEnv();
  const result = await insertShare(env, { id: "s1" });

  assert.deepEqual(result, shareRow);
});

// ---------------------------------------------------------------------------
// insertShareAsset
// ---------------------------------------------------------------------------

test("insertShareAsset: POSTs to share_assets", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([{ id: "asset-1" }]);
  });

  const env = makeEnv();
  await insertShareAsset(env, { share_id: "s1", path: "index.html" });

  assert.ok(capturedUrl!.includes("/rest/v1/share_assets"), `URL: ${capturedUrl}`);
});

test("insertShareAsset: sends the fields as JSON body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return supabaseOk([{}]);
  });

  const env = makeEnv();
  await insertShareAsset(env, { share_id: "s1", path: "index.html", r2_key: "shares/s1/index.html" });

  assert.equal(capturedBody!.share_id, "s1");
  assert.equal(capturedBody!.path, "index.html");
});

// ---------------------------------------------------------------------------
// updateShareScanResult
// ---------------------------------------------------------------------------

test("updateShareScanResult: PATCHes shares with id=eq.<shareId> filter", async () => {
  let capturedUrl: string | undefined;
  let capturedMethod: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown, init: RequestInit) => {
    capturedUrl = String(url);
    capturedMethod = init.method;
    return supabaseOk([{ id: "s1" }]);
  });

  const env = makeEnv();
  await updateShareScanResult(env, "s1", { lifecycle_status: "active" });

  assert.equal(capturedMethod, "PATCH");
  assert.ok(capturedUrl!.includes("id=eq.s1"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("shares?"), `URL: ${capturedUrl}`);
});

test("updateShareScanResult: sends patch fields as JSON body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return supabaseOk([{}]);
  });

  const env = makeEnv();
  await updateShareScanResult(env, "s1", { lifecycle_status: "blocked", moderation_status: "blocked" });

  assert.equal(capturedBody!.lifecycle_status, "blocked");
  assert.equal(capturedBody!.moderation_status, "blocked");
});

test("updateShareScanResult: returns array of updated rows", async () => {
  const row = { id: "s1", lifecycle_status: "active" };
  vi.stubGlobal("fetch", async () => supabaseOk([row]));

  const env = makeEnv();
  const rows = await updateShareScanResult(env, "s1", { lifecycle_status: "active" });

  assert.deepEqual(rows, [row]);
});

// ---------------------------------------------------------------------------
// findUserShares
// ---------------------------------------------------------------------------

test("findUserShares: GETs shares with owner_user_id filter and deleted_at=is.null", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([]);
  });

  const env = makeEnv();
  await findUserShares(env, "user-abc");

  assert.ok(capturedUrl!.includes("owner_user_id=eq.user-abc"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("deleted_at=is.null"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("order=created_at.desc"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("limit=100"), `URL: ${capturedUrl}`);
});

test("findUserShares: returns share rows", async () => {
  const rows = [{ id: "s1" }, { id: "s2" }];
  vi.stubGlobal("fetch", async () => supabaseOk(rows));

  const env = makeEnv();
  const result = await findUserShares(env, "user-1");

  assert.deepEqual(result, rows);
});

// ---------------------------------------------------------------------------
// insertReport
// ---------------------------------------------------------------------------

test("insertReport: POSTs to reports table", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([{ id: "r1" }]);
  });

  const env = makeEnv();
  await insertReport(env, { share_id: "s1", reason: "spam" });

  assert.ok(capturedUrl!.includes("/rest/v1/reports"), `URL: ${capturedUrl}`);
});

test("insertReport: sends fields as JSON body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return supabaseOk([{}]);
  });

  const env = makeEnv();
  await insertReport(env, { share_id: "s1", reporter_user_id: "u1", reason: "spam", details: "looks bad" });

  assert.equal(capturedBody!.share_id, "s1");
  assert.equal(capturedBody!.reporter_user_id, "u1");
  assert.equal(capturedBody!.reason, "spam");
});

// ---------------------------------------------------------------------------
// getOpenReports
// ---------------------------------------------------------------------------

test("getOpenReports: GETs reports with status=eq.open filter", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([]);
  });

  const env = makeEnv();
  await getOpenReports(env);

  assert.ok(capturedUrl!.includes("status=eq.open"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("order=created_at.desc"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("limit=100"), `URL: ${capturedUrl}`);
});

test("getOpenReports: returns report rows", async () => {
  const rows = [{ id: "r1", status: "open" }, { id: "r2", status: "open" }];
  vi.stubGlobal("fetch", async () => supabaseOk(rows));

  const env = makeEnv();
  const result = await getOpenReports(env);

  assert.deepEqual(result, rows);
});

// ---------------------------------------------------------------------------
// findClaimableShare
// ---------------------------------------------------------------------------

test("findClaimableShare: GETs shares with id, claim_token_hash, and owner_user_id=is.null filters", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([]);
  });

  const env = makeEnv();
  await findClaimableShare(env, "share-id-1", "token-hash-abc");

  assert.ok(capturedUrl!.includes("id=eq.share-id-1"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("claim_token_hash=eq."), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("owner_user_id=is.null"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("limit=1"), `URL: ${capturedUrl}`);
});

test("findClaimableShare: returns the share when token matches", async () => {
  const row = { id: "s1", claim_token_hash: "hash123", owner_user_id: null };
  vi.stubGlobal("fetch", async () => supabaseOk([row]));

  const env = makeEnv();
  const result = await findClaimableShare(env, "s1", "hash123");

  assert.deepEqual(result, row);
});

test("findClaimableShare: returns null when no matching share found", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));

  const env = makeEnv();
  const result = await findClaimableShare(env, "s1", "wrong-hash");

  assert.equal(result, null);
});

test("findClaimableShare: URL-encodes the claim token hash", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([]);
  });

  const env = makeEnv();
  await findClaimableShare(env, "s1", "hash with+special=chars");

  assert.ok(capturedUrl!.includes("claim_token_hash=eq.hash%20with%2Bspecial%3Dchars"), `URL: ${capturedUrl}`);
});

// ---------------------------------------------------------------------------
// claimShareRow
// ---------------------------------------------------------------------------

test("claimShareRow: PATCHes shares with id=eq.<shareId> filter", async () => {
  let capturedUrl: string | undefined;
  let capturedMethod: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown, init: RequestInit) => {
    capturedUrl = String(url);
    capturedMethod = init.method;
    return supabaseOk([{ id: "s1", owner_user_id: "user-1" }]);
  });

  const env = makeEnv();
  await claimShareRow(env, "s1", "user-1");

  assert.equal(capturedMethod, "PATCH");
  assert.ok(capturedUrl!.includes("id=eq.s1"), `URL: ${capturedUrl}`);
});

test("claimShareRow: sets owner_user_id, clears claim_token_hash and expires_at", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return supabaseOk([{ id: "s1" }]);
  });

  const env = makeEnv();
  await claimShareRow(env, "s1", "user-42");

  assert.equal(capturedBody!.owner_user_id, "user-42");
  assert.equal(capturedBody!.claim_token_hash, null);
  assert.equal(capturedBody!.expires_at, null);
});

test("claimShareRow: returns the updated share row", async () => {
  const updated = { id: "s1", owner_user_id: "user-1", claim_token_hash: null };
  vi.stubGlobal("fetch", async () => supabaseOk([updated]));

  const env = makeEnv();
  const result = await claimShareRow(env, "s1", "user-1");

  assert.deepEqual(result, updated);
});

test("claimShareRow: returns null when no rows updated", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));

  const env = makeEnv();
  const result = await claimShareRow(env, "s1", "user-1");

  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// softDeleteShare
// ---------------------------------------------------------------------------

test("softDeleteShare: admin delete uses id-only filter (no owner_user_id constraint)", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([{ id: "s1" }]);
  });

  const env = makeEnv();
  await softDeleteShare(env, "s1", true, "any-user-id");

  assert.ok(capturedUrl!.includes("id=eq.s1"), `URL: ${capturedUrl}`);
  assert.ok(!capturedUrl!.includes("owner_user_id"), `Admin filter should not include owner_user_id: ${capturedUrl}`);
});

test("softDeleteShare: non-admin delete includes owner_user_id constraint", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([{ id: "s1" }]);
  });

  const env = makeEnv();
  await softDeleteShare(env, "s1", false, "owner-456");

  assert.ok(capturedUrl!.includes("id=eq.s1"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("owner_user_id=eq.owner-456"), `URL: ${capturedUrl}`);
});

test("softDeleteShare: sets lifecycle_status=deleted and deleted_at in patch body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return supabaseOk([{}]);
  });

  const env = makeEnv();
  await softDeleteShare(env, "s1", true, "user-1");

  assert.equal(capturedBody!.lifecycle_status, "deleted");
  assert.ok(typeof capturedBody!.deleted_at === "string", "deleted_at should be an ISO string");
});

test("softDeleteShare: returns the updated share row", async () => {
  const row = { id: "s1", lifecycle_status: "deleted" };
  vi.stubGlobal("fetch", async () => supabaseOk([row]));

  const env = makeEnv();
  const result = await softDeleteShare(env, "s1", true, "user-1");

  assert.deepEqual(result, row);
});

test("softDeleteShare: returns null when no rows updated", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));

  const env = makeEnv();
  const result = await softDeleteShare(env, "s1", false, "wrong-owner");

  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// setShareModeration
// ---------------------------------------------------------------------------

test("setShareModeration: PATCHes shares with id=eq.<shareId> filter", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([{ id: "s1" }]);
  });

  const env = makeEnv();
  await setShareModeration(env, "s1", { lifecycle_status: "blocked" });

  assert.ok(capturedUrl!.includes("id=eq.s1"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("shares?"), `URL: ${capturedUrl}`);
});

test("setShareModeration: sends the patch object as JSON body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return supabaseOk([{}]);
  });

  const env = makeEnv();
  await setShareModeration(env, "s1", {
    lifecycle_status: "blocked",
    moderation_status: "blocked"
  });

  assert.equal(capturedBody!.lifecycle_status, "blocked");
  assert.equal(capturedBody!.moderation_status, "blocked");
});

test("setShareModeration: returns the updated share row", async () => {
  const row = { id: "s1", lifecycle_status: "blocked" };
  vi.stubGlobal("fetch", async () => supabaseOk([row]));

  const env = makeEnv();
  const result = await setShareModeration(env, "s1", { lifecycle_status: "blocked" });

  assert.deepEqual(result, row);
});

test("setShareModeration: returns null when no row found", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));

  const env = makeEnv();
  const result = await setShareModeration(env, "missing-id", { lifecycle_status: "blocked" });

  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// getUserProfile
// ---------------------------------------------------------------------------

test("getUserProfile: GETs profiles with id=eq.<userId> and selects role,banned_at", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([{ role: "user", banned_at: null }]);
  });

  const env = makeEnv();
  await getUserProfile(env, "user-123");

  assert.ok(capturedUrl!.includes("/rest/v1/profiles"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("id=eq.user-123"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("select=role,banned_at"), `URL: ${capturedUrl}`);
  assert.ok(capturedUrl!.includes("limit=1"), `URL: ${capturedUrl}`);
});

test("getUserProfile: returns the profile row when found", async () => {
  const profile = { role: "admin" as const, banned_at: null };
  vi.stubGlobal("fetch", async () => supabaseOk([profile]));

  const env = makeEnv();
  const result = await getUserProfile(env, "admin-1");

  assert.deepEqual(result, profile);
});

test("getUserProfile: returns null when profile not found", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));

  const env = makeEnv();
  const result = await getUserProfile(env, "new-user");

  assert.equal(result, null);
});

test("getUserProfile: returns banned_at when profile has a ban", async () => {
  vi.stubGlobal("fetch", async () =>
    supabaseOk([{ role: "user", banned_at: "2025-01-01T00:00:00Z" }])
  );

  const env = makeEnv();
  const result = await getUserProfile(env, "banned-user");

  assert.equal(result!.banned_at, "2025-01-01T00:00:00Z");
});

// ---------------------------------------------------------------------------
// insertUserProfile
// ---------------------------------------------------------------------------

test("insertUserProfile: POSTs to profiles table", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return supabaseOk([{ id: "u1" }]);
  });

  const env = makeEnv();
  await insertUserProfile(env, "u1", "alice");

  assert.ok(capturedUrl!.includes("/rest/v1/profiles"), `URL: ${capturedUrl}`);
});

test("insertUserProfile: sends id and display_name in body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return supabaseOk([{}]);
  });

  const env = makeEnv();
  await insertUserProfile(env, "u1", "alice");

  assert.equal(capturedBody!.id, "u1");
  assert.equal(capturedBody!.display_name, "alice");
});
