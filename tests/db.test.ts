import assert from "node:assert/strict";
import { test, afterEach, vi } from "vitest";

import {
  restRequest,
  restSelect,
  restInsert,
  restUpdate,
  getShareBySlug,
  logShareEvent,
  createUniqueSlug,
  toPublicShare,
  randomSlug,
  createSecretToken,
  requireWorkerDatabaseAccess,
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
// restRequest
// ---------------------------------------------------------------------------

test("restRequest: builds correct URL from SUPABASE_URL and path", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown, _init: unknown) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restRequest(env, "shares?select=*", { method: "GET" });

  assert.equal(capturedUrl, "https://proj.supabase.co/rest/v1/shares?select=*");
});

test("restRequest: sets apikey header to SUPABASE_REST_KEY", async () => {
  let capturedHeaders: Headers | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedHeaders = init.headers as Headers;
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restRequest(env, "shares?select=*", { method: "GET" });

  assert.equal(capturedHeaders!.get("apikey"), "anon-key");
});

test("restRequest: sets authorization header to Bearer SUPABASE_REST_KEY", async () => {
  let capturedHeaders: Headers | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedHeaders = init.headers as Headers;
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restRequest(env, "shares?select=*", { method: "GET" });

  assert.equal(capturedHeaders!.get("authorization"), "Bearer anon-key");
});

test("restRequest: sets x-worker-secret header to WORKER_API_SECRET", async () => {
  let capturedHeaders: Headers | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedHeaders = init.headers as Headers;
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restRequest(env, "shares?select=*", { method: "GET" });

  assert.equal(capturedHeaders!.get("x-worker-secret"), "worker-secret");
});

test("restRequest: does NOT set content-type when no body is present", async () => {
  let capturedHeaders: Headers | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedHeaders = init.headers as Headers;
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restRequest(env, "shares?select=*", { method: "GET" });

  assert.equal(capturedHeaders!.get("content-type"), null);
});

test("restRequest: sets content-type to application/json when body is present", async () => {
  let capturedHeaders: Headers | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedHeaders = init.headers as Headers;
    return new Response(JSON.stringify([{ id: "x" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restRequest(env, "shares?select=*", {
    method: "POST",
    body: JSON.stringify({ foo: "bar" }),
  });

  assert.equal(capturedHeaders!.get("content-type"), "application/json");
});

test("restRequest: returns parsed JSON from response", async () => {
  vi.stubGlobal("fetch", async () => {
    return new Response(JSON.stringify([{ id: "abc" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  const result = await restRequest<{ id: string }[]>(env, "shares?select=*", { method: "GET" });

  assert.deepEqual(result, [{ id: "abc" }]);
});

test("restRequest: returns undefined for 204 No Content", async () => {
  vi.stubGlobal("fetch", async () => {
    return new Response(null, { status: 204 });
  });

  const env = makeEnv();
  const result = await restRequest(env, "shares?select=*", { method: "GET" });

  assert.equal(result, undefined);
});

test("restRequest: throws on non-ok response, message includes status and body text", async () => {
  vi.stubGlobal("fetch", async () => {
    return new Response("row not found", { status: 404 });
  });

  const env = makeEnv();
  await assert.rejects(
    restRequest(env, "shares?select=*", { method: "GET" }),
    (err: Error) => {
      return err.message.includes("404") && err.message.includes("row not found");
    }
  );
});

test("restRequest: throws when env secrets are missing", async () => {
  const env = makeEnv({ SUPABASE_REST_KEY: "" });
  await assert.rejects(restRequest(env, "shares", { method: "GET" }), /SUPABASE_REST_KEY/);
});

// ---------------------------------------------------------------------------
// restSelect
// ---------------------------------------------------------------------------

test("restSelect: issues GET request", async () => {
  let capturedMethod: string | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedMethod = init.method as string;
    return new Response(JSON.stringify([{ id: "1" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restSelect(env, "shares?select=*");

  assert.equal(capturedMethod, "GET");
});

test("restSelect: passes path verbatim to fetch URL", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restSelect(env, "shares?select=*&slug=eq.abc&limit=1");

  assert.equal(
    capturedUrl,
    "https://proj.supabase.co/rest/v1/shares?select=*&slug=eq.abc&limit=1"
  );
});

test("restSelect: returns array of parsed rows", async () => {
  vi.stubGlobal("fetch", async () => {
    return new Response(JSON.stringify([{ id: "x" }, { id: "y" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  const rows = await restSelect<{ id: string }>(env, "shares?select=*");

  assert.deepEqual(rows, [{ id: "x" }, { id: "y" }]);
});

// ---------------------------------------------------------------------------
// restInsert
// ---------------------------------------------------------------------------

test("restInsert: issues POST request", async () => {
  let capturedMethod: string | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedMethod = init.method as string;
    return new Response(JSON.stringify([{ id: "new" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restInsert(env, "shares", { id: "new", slug: "abc" });

  assert.equal(capturedMethod, "POST");
});

test("restInsert: appends ?select=* to table path", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify([{ id: "1" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restInsert(env, "shares", { id: "1" });

  assert.equal(capturedUrl, "https://proj.supabase.co/rest/v1/shares?select=*");
});

test("restInsert: sends prefer: return=representation header", async () => {
  let capturedHeaders: Headers | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedHeaders = init.headers as Headers;
    return new Response(JSON.stringify([{ id: "1" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restInsert(env, "shares", { id: "1" });

  assert.equal(capturedHeaders!.get("prefer"), "return=representation");
});

test("restInsert: sends row as JSON body", async () => {
  let capturedBody: string | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = init.body as string;
    return new Response(JSON.stringify([{ id: "1", slug: "xyz" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restInsert(env, "shares", { id: "1", slug: "xyz" });

  assert.deepEqual(JSON.parse(capturedBody!), { id: "1", slug: "xyz" });
});

test("restInsert: returns first element of the array", async () => {
  vi.stubGlobal("fetch", async () => {
    return new Response(JSON.stringify([{ id: "first" }, { id: "second" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  const result = await restInsert<{ id: string }>(env, "shares", { id: "first" });

  assert.deepEqual(result, { id: "first" });
});

// ---------------------------------------------------------------------------
// restUpdate
// ---------------------------------------------------------------------------

test("restUpdate: issues PATCH request", async () => {
  let capturedMethod: string | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedMethod = init.method as string;
    return new Response(JSON.stringify([{ id: "1" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restUpdate(env, "shares", "id=eq.1", { lifecycle_status: "active" });

  assert.equal(capturedMethod, "PATCH");
});

test("restUpdate: builds URL as table?filter&select=*", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify([{ id: "1" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restUpdate(env, "shares", "id=eq.abc", { lifecycle_status: "active" });

  assert.equal(
    capturedUrl,
    "https://proj.supabase.co/rest/v1/shares?id=eq.abc&select=*"
  );
});

test("restUpdate: sends prefer: return=representation header", async () => {
  let capturedHeaders: Headers | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedHeaders = init.headers as Headers;
    return new Response(JSON.stringify([{ id: "1" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restUpdate(env, "shares", "id=eq.1", { lifecycle_status: "active" });

  assert.equal(capturedHeaders!.get("prefer"), "return=representation");
});

test("restUpdate: sends patch as JSON body", async () => {
  let capturedBody: string | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = init.body as string;
    return new Response(JSON.stringify([{ id: "1" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await restUpdate(env, "shares", "id=eq.1", { lifecycle_status: "active" });

  assert.deepEqual(JSON.parse(capturedBody!), { lifecycle_status: "active" });
});

test("restUpdate: returns array of updated rows", async () => {
  vi.stubGlobal("fetch", async () => {
    return new Response(JSON.stringify([{ id: "1", lifecycle_status: "active" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  const rows = await restUpdate<{ id: string; lifecycle_status: string }>(
    env,
    "shares",
    "id=eq.1",
    { lifecycle_status: "active" }
  );

  assert.deepEqual(rows, [{ id: "1", lifecycle_status: "active" }]);
});

// ---------------------------------------------------------------------------
// getShareBySlug
// ---------------------------------------------------------------------------

test("getShareBySlug: requests shares?select=*&slug=eq.<slug>&limit=1", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify([{ id: "s1", slug: "abc" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
  vi.stubGlobal("fetch", async () => {
    return new Response(JSON.stringify([fakeShare]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  const result = await getShareBySlug(env, "abc");

  assert.deepEqual(result, fakeShare);
});

test("getShareBySlug: returns null when no rows returned", async () => {
  vi.stubGlobal("fetch", async () => {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  const result = await getShareBySlug(env, "notfound");

  assert.equal(result, null);
});

test("getShareBySlug: URL-encodes the slug", async () => {
  let capturedUrl: string | undefined;
  vi.stubGlobal("fetch", async (url: unknown) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
    return new Response(JSON.stringify([{}]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  await logShareEvent(env, "share-1", "user-1", "created", "iphash", "uahash", { risk_score: 0 });

  assert.ok(capturedUrl!.includes("/rest/v1/share_events"), `URL was: ${capturedUrl}`);
});

test("logShareEvent: sends correct fields in body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return new Response(JSON.stringify([{}]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
    return new Response(JSON.stringify([{}]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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

// SLUG_ALPHABET is the character set actually used (read from source):
// "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
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
  // extremely unlikely to collide — chance is negligible for length 10 alphabet^10
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
  // 24 bytes → base64 = 32 chars (24 * 4/3 = 32, no padding since 24 % 3 === 0)
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
  // First call: existing=[], meaning slug is unique
  vi.stubGlobal("fetch", async () => {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  const slug = await createUniqueSlug(env);
  assert.equal(typeof slug, "string");
});

test("createUniqueSlug: returns a slug of length 10 when first attempt is unique", async () => {
  vi.stubGlobal("fetch", async () => {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  const slug = await createUniqueSlug(env);
  assert.equal(slug.length, 10);
});

test("createUniqueSlug: retries until a unique slug is found", async () => {
  let callCount = 0;
  vi.stubGlobal("fetch", async () => {
    callCount++;
    // First 3 calls return a collision, 4th returns empty (unique)
    const rows = callCount < 4 ? [{ id: "existing" }] : [];
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  const slug = await createUniqueSlug(env);
  assert.equal(typeof slug, "string");
  assert.ok(slug.length >= 10, `slug length was ${slug.length}`);
  assert.equal(callCount, 4);
});

test("createUniqueSlug: appends Date.now base36 when all 6 attempts collide", async () => {
  // All fetches return a row (collision)
  vi.stubGlobal("fetch", async () => {
    return new Response(JSON.stringify([{ id: "existing" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const env = makeEnv();
  const slug = await createUniqueSlug(env);
  // After 6 collisions, returns randomSlug(10) + Date.now().toString(36)
  // So length is > 10
  assert.ok(slug.length > 10, `expected length > 10, got ${slug.length}`);
});
