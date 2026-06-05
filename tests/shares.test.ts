import assert from "node:assert/strict";
import { test, afterEach, vi } from "vitest";

import {
  createShareRecord,
  checkUploadRate,
  previewMessage,
  previewHeaders,
  createShare,
  listMyShares,
  getPublicShare,
  reportShare,
  claimShare,
  deleteShare,
  listReports,
  moderateShare,
  previewShare,
} from "../src/worker/shares.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_REST_KEY: "rest-key",
    WORKER_API_SECRET: "worker-secret",
    SUPABASE_PUBLISHABLE_KEY: "pub-key",
    IP_HASH_SALT: "test-salt",
    SHARE_HTML_BUCKET: {
      put: vi.fn(async () => {}),
      get: vi.fn(async () => null),
    },
    ...overrides,
  } as any;
}

function makeCtx() {
  return { waitUntil: vi.fn() } as any;
}

function makeRequest(
  url = "https://sharehtml.zhenjia.dev/api/shares",
  opts: RequestInit = {},
  headers: Record<string, string> = {}
) {
  const h = new Headers(headers);
  return new Request(url, { ...opts, headers: h });
}

// ---------------------------------------------------------------------------
// Supabase REST response helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Response that looks like Supabase REST returning rows.
 */
function supabaseOk(rows: unknown = []) {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function supabaseEmpty() {
  return new Response(null, { status: 204 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// previewMessage
// ---------------------------------------------------------------------------

test("previewMessage: returns a Response with the given status code", () => {
  const req = makeRequest("https://sharehtml.zhenjia.dev/v/abc/");
  const env = makeEnv();
  const res = previewMessage("Share not found.", 404, req, env);
  assert.equal(res.status, 404);
});

test("previewMessage: response body is HTML containing the escaped message", async () => {
  const req = makeRequest("https://sharehtml.zhenjia.dev/v/abc/");
  const env = makeEnv();
  // Message with HTML special chars to verify escaping
  const res = previewMessage("<script>xss</script>", 410, req, env);
  const body = await res.text();
  assert.ok(body.includes("&lt;script&gt;xss&lt;/script&gt;"), "message should be HTML-escaped");
  assert.ok(body.toLowerCase().includes("<!doctype html"), "should be an HTML document");
});

test("previewMessage: 403 status renders HTML body with message text", async () => {
  const req = makeRequest("https://sharehtml.zhenjia.dev/v/abc/");
  const env = makeEnv();
  const res = previewMessage("This share was blocked by moderation.", 403, req, env);
  assert.equal(res.status, 403);
  const body = await res.text();
  assert.ok(body.includes("This share was blocked by moderation."), "body should include message");
});

test("previewMessage: response headers include content-type text/html", () => {
  const req = makeRequest("https://sharehtml.zhenjia.dev/v/abc/");
  const env = makeEnv();
  const res = previewMessage("gone", 410, req, env);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.includes("text/html"), `expected text/html content-type, got ${ct}`);
});

// ---------------------------------------------------------------------------
// previewHeaders
// ---------------------------------------------------------------------------

test("previewHeaders: sets x-content-type-options to nosniff", () => {
  const req = makeRequest();
  const env = makeEnv();
  const headers = previewHeaders(req, env);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
});

test("previewHeaders: sets content-security-policy header", () => {
  const req = makeRequest();
  const env = makeEnv();
  const headers = previewHeaders(req, env);
  const csp = headers.get("content-security-policy") ?? "";
  assert.ok(csp.length > 0, "CSP header should be present");
  assert.ok(csp.includes("default-src"), "CSP should contain default-src directive");
});

test("previewHeaders: merges extra headers into result", () => {
  const req = makeRequest();
  const env = makeEnv();
  const headers = previewHeaders(req, env, { etag: '"abc123"' });
  assert.equal(headers.get("etag"), '"abc123"');
});

test("previewHeaders: uses APP_ORIGIN in frame-ancestors CSP directive", () => {
  const req = makeRequest();
  const env = makeEnv({ APP_ORIGIN: "https://myapp.example.com" });
  const headers = previewHeaders(req, env);
  const csp = headers.get("content-security-policy") ?? "";
  assert.ok(
    csp.includes("https://myapp.example.com"),
    "frame-ancestors should include APP_ORIGIN"
  );
});

// ---------------------------------------------------------------------------
// checkUploadRate
// ---------------------------------------------------------------------------

test("checkUploadRate: returns allowed=true when count is below anonymous limit (10)", async () => {
  // Return 5 rows — under the anonymous limit of 10
  vi.stubGlobal("fetch", async () => supabaseOk(new Array(5).fill({ id: "x" })));
  const env = makeEnv();
  const result = await checkUploadRate(env, null, "ip-hash-value");
  assert.equal(result.allowed, true);
});

test("checkUploadRate: returns allowed=false when anonymous count exceeds limit (11 rows > 10)", async () => {
  // Return 11 rows — over the anonymous limit of 10
  vi.stubGlobal("fetch", async () => supabaseOk(new Array(11).fill({ id: "x" })));
  const env = makeEnv();
  const result = await checkUploadRate(env, null, "ip-hash-value");
  assert.equal(result.allowed, false);
  assert.ok(result.reason?.includes("Anonymous upload limit"), `unexpected reason: ${result.reason}`);
});

test("checkUploadRate: returns allowed=true when user count is below user limit (100)", async () => {
  // Return 50 rows — under the user limit of 100
  vi.stubGlobal("fetch", async () => supabaseOk(new Array(50).fill({ id: "x" })));
  const env = makeEnv();
  const user = { id: "user-1", role: "user" as const, banned_at: null };
  const result = await checkUploadRate(env, user, "ip-hash-value");
  assert.equal(result.allowed, true);
});

test("checkUploadRate: returns allowed=false when user count exceeds user limit (101 rows > 100)", async () => {
  // Return 101 rows — over the user limit of 100
  vi.stubGlobal("fetch", async () => supabaseOk(new Array(101).fill({ id: "x" })));
  const env = makeEnv();
  const user = { id: "user-1", role: "user" as const, banned_at: null };
  const result = await checkUploadRate(env, user, "ip-hash-value");
  assert.equal(result.allowed, false);
  assert.ok(result.reason?.includes("User upload limit"), `unexpected reason: ${result.reason}`);
});

test("checkUploadRate: uses user ID filter when user is provided (behavior: allowed=true at 0 uploads)", async () => {
  // URL query-string assertions for the user branch live in db.test.ts.
  // Here we confirm the behavior: 0 uploads → allowed.
  vi.stubGlobal("fetch", async () => supabaseOk([]));
  const env = makeEnv();
  const user = { id: "user-abc-123", role: "user" as const, banned_at: null };
  const result = await checkUploadRate(env, user, "ip-hash");
  assert.equal(result.allowed, true);
});

test("checkUploadRate: uses ip_hash filter when user is null (behavior: allowed=true at 0 uploads)", async () => {
  // URL query-string assertions for the IP branch live in db.test.ts.
  // Here we confirm the behavior: 0 uploads → allowed.
  vi.stubGlobal("fetch", async () => supabaseOk([]));
  const env = makeEnv();
  const result = await checkUploadRate(env, null, "my-ip-hash");
  assert.equal(result.allowed, true);
});

// ---------------------------------------------------------------------------
// createShareRecord
// ---------------------------------------------------------------------------

/** Minimal share record returned by the DB after insert/update */
function makeShareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "share-id-1",
    slug: "ABCDE12345",
    owner_user_id: null,
    title: "Test Share",
    entry_path: "index.html",
    r2_prefix: "shares/share-id-1/",
    size_bytes: 100,
    content_hash: "abc123",
    lifecycle_status: "active",
    moderation_status: "clean",
    risk_score: 0,
    risk_reasons: [],
    claim_token_hash: null,
    expires_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

/**
 * Build a fetch mock that sequences through DB calls in the order
 * createShareRecord makes them:
 * 1. createUniqueSlug: GET shares?select=id&slug=eq.{slug}&limit=1 → []
 * 2. restInsert shares: POST shares?select=* → [shareRow]
 * 3. restInsert share_assets: POST share_assets?select=* → [assetRow]
 * 4. restUpdate shares lifecycle: PATCH shares?id=eq.{id}&select=* → [updatedRow]
 * 5. logShareEvent: POST share_events?select=* → [eventRow]
 */
function makeCreateShareFetch(shareRow: Record<string, unknown>) {
  let call = 0;
  return vi.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    call++;
    // createUniqueSlug slug uniqueness check
    if (method === "GET" && u.includes("slug=eq.")) {
      return supabaseOk([]); // no collision
    }
    // Any POST to shares (insert) or share_assets
    if (method === "POST" && u.includes("shares?select=*")) {
      return supabaseOk([shareRow]);
    }
    if (method === "POST" && u.includes("share_assets")) {
      return supabaseOk([{ id: "asset-1" }]);
    }
    // PATCH shares (update lifecycle)
    if (method === "PATCH" && u.includes("shares?")) {
      return supabaseOk([shareRow]);
    }
    // logShareEvent insert
    if (method === "POST" && u.includes("share_events")) {
      return supabaseOk([{}]);
    }
    // Fallback — profiles lookup for auth (shouldn't be reached in these tests)
    if (method === "GET" && u.includes("profiles")) {
      return supabaseOk([{ role: "user", banned_at: null }]);
    }
    // Fallback for rate limit check
    if (method === "GET" && u.includes("creator_ip_hash")) {
      return supabaseOk([]);
    }
    if (method === "GET" && u.includes("owner_user_id")) {
      return supabaseOk([]);
    }
    throw new Error(`Unexpected fetch call #${call}: ${method} ${u}`);
  });
}

const MINIMAL_HTML = "<!doctype html><html><body><p>Hello</p></body></html>";

test("createShareRecord: happy path returns status 201 and expected body shape", async () => {
  const shareRow = makeShareRow();
  vi.stubGlobal("fetch", makeCreateShareFetch(shareRow));
  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest();

  const result = await createShareRecord(env, ctx, req, {
    html: MINIMAL_HTML,
    title: "My Share",
    user: null,
  });

  assert.equal(result.status, 201);
  assert.ok("share" in result.body, "body should contain share");
  assert.ok("claimToken" in result.body, "body should contain claimToken");
  assert.ok("message" in result.body, "body should contain message");
});

test("createShareRecord: claimToken is non-null for anonymous uploads", async () => {
  const shareRow = makeShareRow();
  vi.stubGlobal("fetch", makeCreateShareFetch(shareRow));
  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest();

  const result = await createShareRecord(env, ctx, req, {
    html: MINIMAL_HTML,
    title: "",
    user: null,
  });

  assert.equal(result.status, 201);
  assert.ok(result.body.claimToken !== null, "anonymous upload should have a claim token");
  assert.equal(typeof result.body.claimToken, "string");
});

test("createShareRecord: claimToken is null for authenticated users", async () => {
  const user = { id: "user-1", email: "u@test.com", role: "user" as const, banned_at: null };
  const shareRow = makeShareRow({ owner_user_id: user.id });

  // For authenticated user, rate limit uses owner_user_id filter
  const fetchMock = vi.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    if (method === "GET" && u.includes("slug=eq.")) return supabaseOk([]);
    if (method === "GET" && u.includes("owner_user_id=eq.user-1")) return supabaseOk([]);
    if (method === "POST" && u.includes("shares?select=*")) return supabaseOk([shareRow]);
    if (method === "POST" && u.includes("share_assets")) return supabaseOk([{ id: "asset-1" }]);
    if (method === "PATCH") return supabaseOk([shareRow]);
    if (method === "POST" && u.includes("share_events")) return supabaseOk([{}]);
    throw new Error(`Unexpected: ${method} ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest();

  const result = await createShareRecord(env, ctx, req, {
    html: MINIMAL_HTML,
    title: "",
    user,
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.claimToken, null, "authenticated user should have null claim token");
});

test("createShareRecord: writes to R2 bucket (put is called)", async () => {
  const shareRow = makeShareRow();
  vi.stubGlobal("fetch", makeCreateShareFetch(shareRow));
  const putMock = vi.fn(async () => {});
  const env = makeEnv({
    SHARE_HTML_BUCKET: { put: putMock, get: vi.fn(async () => null) },
  });
  const ctx = makeCtx();
  const req = makeRequest();

  await createShareRecord(env, ctx, req, {
    html: MINIMAL_HTML,
    title: "",
    user: null,
  });

  assert.equal(putMock.mock.calls.length, 1, "R2 put should be called exactly once");
  const [r2Key, r2Body] = putMock.mock.calls[0];
  assert.ok(typeof r2Key === "string" && r2Key.endsWith("index.html"), `unexpected R2 key: ${r2Key}`);
  assert.equal(r2Body, MINIMAL_HTML, "R2 body should be the HTML content");
});

test("createShareRecord: blocked scan produces status 202", async () => {
  // Build HTML that will trigger score >= 80: combine external_password_form(40) + wallet_keywords(25) + top_navigation_attempt(20) = 85
  const blockedHtml = `<!doctype html>
<html><body>
<form action="https://evil.example.com/login">
  <input type="password" name="p">
</form>
<p>seed phrase private key</p>
<script>window.location.href = "https://evil.com";</script>
</body></html>`;

  const shareRow = makeShareRow({ lifecycle_status: "blocked", moderation_status: "blocked", risk_score: 85 });

  const fetchMock = vi.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    if (method === "GET" && u.includes("slug=eq.")) return supabaseOk([]);
    if (method === "GET" && u.includes("creator_ip_hash")) return supabaseOk([]);
    if (method === "POST" && u.includes("shares?select=*")) return supabaseOk([shareRow]);
    if (method === "POST" && u.includes("share_assets")) return supabaseOk([{ id: "asset-1" }]);
    if (method === "PATCH") return supabaseOk([shareRow]);
    if (method === "POST" && u.includes("share_events")) return supabaseOk([{}]);
    throw new Error(`Unexpected: ${method} ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest();

  const result = await createShareRecord(env, ctx, req, {
    html: blockedHtml,
    title: "",
    user: null,
  });

  assert.equal(result.status, 202, "blocked upload should return 202");
  assert.ok((result.body.message as string).includes("blocked"), "message should mention blocked");
});

test("createShareRecord: rate-limited anonymous upload returns 429", async () => {
  // Rate limit check returns 11 rows (exceeds limit of 10)
  vi.stubGlobal("fetch", async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    // slug uniqueness check
    if (method === "GET" && u.includes("slug=eq.")) return supabaseOk([]);
    // rate limit check - return 11 rows to exceed limit
    if (method === "GET" && u.includes("creator_ip_hash")) {
      return supabaseOk(new Array(11).fill({ id: "x" }));
    }
    throw new Error(`Unexpected: ${method} ${u}`);
  });

  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest();

  const result = await createShareRecord(env, ctx, req, {
    html: MINIMAL_HTML,
    title: "",
    user: null,
  });

  assert.equal(result.status, 429);
  assert.ok(typeof result.body.error === "string", "should have an error message");
});

test("createShareRecord: oversized HTML returns 413", async () => {
  // Default anonymous max is 1 MB; generate something just over
  const bigHtml = "<!doctype html><html><body>" + "x".repeat(1024 * 1024 + 1) + "</body></html>";

  // Rate limit check should succeed (returns [])
  vi.stubGlobal("fetch", async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    if (method === "GET" && u.includes("slug=eq.")) return supabaseOk([]);
    if (method === "GET" && u.includes("creator_ip_hash")) return supabaseOk([]);
    throw new Error(`Unexpected: ${method} ${u}`);
  });

  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest();

  const result = await createShareRecord(env, ctx, req, {
    html: bigHtml,
    title: "",
    user: null,
  });

  assert.equal(result.status, 413);
  assert.ok(typeof result.body.error === "string");
});

test("createShareRecord: non-HTML content returns 422", async () => {
  const plainText = "Hello, this is just plain text with no HTML markers.";

  vi.stubGlobal("fetch", async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    if (method === "GET" && u.includes("slug=eq.")) return supabaseOk([]);
    if (method === "GET" && u.includes("creator_ip_hash")) return supabaseOk([]);
    throw new Error(`Unexpected: ${method} ${u}`);
  });

  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest();

  const result = await createShareRecord(env, ctx, req, {
    html: plainText,
    title: "",
    user: null,
  });

  assert.equal(result.status, 422);
  assert.ok((result.body.error as string).includes("HTML"), "error should mention HTML");
});

test("createShareRecord: empty HTML returns 413 (zero bytes)", async () => {
  vi.stubGlobal("fetch", async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    if (method === "GET" && u.includes("slug=eq.")) return supabaseOk([]);
    if (method === "GET" && u.includes("creator_ip_hash")) return supabaseOk([]);
    throw new Error(`Unexpected: ${method} ${u}`);
  });

  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest();

  const result = await createShareRecord(env, ctx, req, {
    html: "",
    title: "",
    user: null,
  });

  assert.equal(result.status, 413);
});

test("createShareRecord: R2 failure rolls back lifecycle_status to failed", async () => {
  const shareRow = makeShareRow();
  const putMock = vi.fn(async () => {
    throw new Error("R2 write error");
  });

  // Track whether the PATCH for failed status was issued
  let patchedToFailed = false;
  const fetchMock = vi.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    if (method === "GET" && u.includes("slug=eq.")) return supabaseOk([]);
    if (method === "GET" && u.includes("creator_ip_hash")) return supabaseOk([]);
    if (method === "POST" && u.includes("shares?select=*")) return supabaseOk([shareRow]);
    if (method === "PATCH") {
      // Check if this is the rollback patch
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.lifecycle_status === "failed") patchedToFailed = true;
      return supabaseOk([shareRow]);
    }
    throw new Error(`Unexpected: ${method} ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const env = makeEnv({
    SHARE_HTML_BUCKET: { put: putMock, get: vi.fn(async () => null) },
  });
  const ctx = makeCtx();
  const req = makeRequest();

  const result = await createShareRecord(env, ctx, req, {
    html: MINIMAL_HTML,
    title: "",
    user: null,
  });

  assert.equal(result.status, 500, "R2 failure should return 500");
  assert.equal(patchedToFailed, true, "should PATCH lifecycle_status to 'failed' on R2 error");
});

test("createShareRecord: calls ctx.waitUntil for the event log on success", async () => {
  const shareRow = makeShareRow();
  vi.stubGlobal("fetch", makeCreateShareFetch(shareRow));
  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest();

  await createShareRecord(env, ctx, req, {
    html: MINIMAL_HTML,
    title: "",
    user: null,
  });

  assert.equal(ctx.waitUntil.mock.calls.length, 1, "ctx.waitUntil should be called once");
});

// ---------------------------------------------------------------------------
// createShare (HTTP handler)
// ---------------------------------------------------------------------------

test("createShare: rejects non-file upload with 422", async () => {
  // requireWorkerDatabaseAccess needs keys set, but we need to provide formdata
  // Mock fetch so DB calls don't actually happen — but createShare checks file first
  vi.stubGlobal("fetch", async () => supabaseOk([]));

  const env = makeEnv();
  const ctx = makeCtx();

  const form = new FormData();
  form.append("title", "no file here");
  const req = new Request("https://sharehtml.zhenjia.dev/api/shares", {
    method: "POST",
    body: form,
  });

  const res = await createShare(req, env, ctx);
  assert.equal(res.status, 422);
});

test("createShare: rejects non-.html file extension with 422", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));

  const env = makeEnv();
  const ctx = makeCtx();

  const form = new FormData();
  const file = new File(["<html></html>"], "page.txt", { type: "text/plain" });
  form.append("file", file);
  const req = new Request("https://sharehtml.zhenjia.dev/api/shares", {
    method: "POST",
    body: form,
  });

  const res = await createShare(req, env, ctx);
  assert.equal(res.status, 422);
});

test("createShare: accepts .htm file extension", async () => {
  const shareRow = makeShareRow();
  vi.stubGlobal("fetch", makeCreateShareFetch(shareRow));

  const env = makeEnv();
  const ctx = makeCtx();

  const form = new FormData();
  const file = new File([MINIMAL_HTML], "page.htm", { type: "text/html" });
  form.append("file", file);
  const req = new Request("https://sharehtml.zhenjia.dev/api/shares", {
    method: "POST",
    body: form,
  });

  const res = await createShare(req, env, ctx);
  // Should NOT be 422 from extension check; any non-422 from this path is correct
  assert.notEqual(res.status, 422);
});

test("createShare: banned user is rejected with 403", async () => {
  // Mock Supabase auth to return a banned user
  vi.stubGlobal("fetch", async (url: unknown) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-banned", email: "b@test.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("profiles")) {
      return supabaseOk([{ role: "user", banned_at: "2024-01-01T00:00:00Z" }]);
    }
    return supabaseOk([]);
  });

  const env = makeEnv();
  const ctx = makeCtx();

  const form = new FormData();
  const file = new File([MINIMAL_HTML], "page.html", { type: "text/html" });
  form.append("file", file);
  const req = new Request("https://sharehtml.zhenjia.dev/api/shares", {
    method: "POST",
    body: form,
    headers: { authorization: "Bearer token-for-banned-user" },
  });

  const res = await createShare(req, env, ctx);
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// listMyShares
// ---------------------------------------------------------------------------

test("listMyShares: returns 401 when no auth token provided", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));
  const env = makeEnv();
  const req = makeRequest("https://sharehtml.zhenjia.dev/api/shares");
  const res = await listMyShares(req, env);
  assert.equal(res.status, 401);
});

test("listMyShares: returns 200 with shares array for authenticated user", async () => {
  const shareRow = makeShareRow({ owner_user_id: "user-1" });
  vi.stubGlobal("fetch", async (url: unknown) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-1", email: "u@test.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("profiles")) return supabaseOk([{ role: "user", banned_at: null }]);
    if (u.includes("shares?select=*")) return supabaseOk([shareRow]);
    return supabaseOk([]);
  });

  const env = makeEnv();
  const req = makeRequest("https://sharehtml.zhenjia.dev/api/shares", {}, {
    authorization: "Bearer valid-token",
  });

  const res = await listMyShares(req, env);
  assert.equal(res.status, 200);
  const body = await res.json() as { shares: unknown[] };
  assert.ok(Array.isArray(body.shares), "body.shares should be an array");
  assert.equal(body.shares.length, 1);
});

// ---------------------------------------------------------------------------
// getPublicShare
// ---------------------------------------------------------------------------

test("getPublicShare: returns 404 for unknown slug", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([])); // empty array → not found
  const env = makeEnv();
  const req = makeRequest();
  const res = await getPublicShare("no-such-slug", req, env);
  assert.equal(res.status, 404);
});

test("getPublicShare: returns 200 with share data for known slug", async () => {
  const shareRow = makeShareRow();
  vi.stubGlobal("fetch", async () => supabaseOk([shareRow]));
  const env = makeEnv();
  const req = makeRequest();
  const res = await getPublicShare("ABCDE12345", req, env);
  assert.equal(res.status, 200);
  const body = await res.json() as { share: Record<string, unknown> };
  assert.ok(body.share, "body should contain share object");
  assert.equal(body.share.slug, "ABCDE12345");
});

test("getPublicShare: returns 404 for a deleted share", async () => {
  const shareRow = makeShareRow({ deleted_at: "2024-01-01T00:00:00Z" });
  vi.stubGlobal("fetch", async () => supabaseOk([shareRow]));
  const env = makeEnv();
  const req = makeRequest();
  const res = await getPublicShare("deleted-slug", req, env);
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// reportShare
// ---------------------------------------------------------------------------

test("reportShare: returns 200 ok=true after inserting report", async () => {
  vi.stubGlobal("fetch", async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    // report insert
    if (method === "POST" && u.includes("reports")) return supabaseOk([{ id: "r1" }]);
    // event log
    if (method === "POST" && u.includes("share_events")) return supabaseOk([{}]);
    return supabaseOk([]);
  });

  const env = makeEnv();
  const ctx = makeCtx();
  const req = new Request("https://sharehtml.zhenjia.dev/api/shares/share-id-1/report", {
    method: "POST",
    body: JSON.stringify({ reason: "spam", details: "Looks spammy" }),
    headers: { "content-type": "application/json" },
  });

  const res = await reportShare("share-id-1", req, env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assert.equal(body.ok, true);
});

// ---------------------------------------------------------------------------
// claimShare
// ---------------------------------------------------------------------------

test("claimShare: returns 401 when not authenticated", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));
  const env = makeEnv();
  const ctx = makeCtx();
  const req = new Request("https://sharehtml.zhenjia.dev/api/shares/share-id-1/claim", {
    method: "POST",
    body: JSON.stringify({ claimToken: "token123" }),
    headers: { "content-type": "application/json" },
  });

  const res = await claimShare("share-id-1", req, env, ctx);
  assert.equal(res.status, 401);
});

test("claimShare: returns 422 when claimToken is missing", async () => {
  vi.stubGlobal("fetch", async (url: unknown) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-1", email: "u@test.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("profiles")) return supabaseOk([{ role: "user", banned_at: null }]);
    return supabaseOk([]);
  });

  const env = makeEnv();
  const ctx = makeCtx();
  const req = new Request("https://sharehtml.zhenjia.dev/api/shares/share-id-1/claim", {
    method: "POST",
    body: JSON.stringify({}),
    headers: {
      "content-type": "application/json",
      authorization: "Bearer valid-token",
    },
  });

  const res = await claimShare("share-id-1", req, env, ctx);
  assert.equal(res.status, 422);
});

test("claimShare: returns 403 when claimToken does not match", async () => {
  vi.stubGlobal("fetch", async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-1", email: "u@test.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("profiles")) return supabaseOk([{ role: "user", banned_at: null }]);
    // claim lookup returns empty → token mismatch
    if (method === "GET" && u.includes("claim_token_hash")) return supabaseOk([]);
    return supabaseOk([]);
  });

  const env = makeEnv();
  const ctx = makeCtx();
  const req = new Request("https://sharehtml.zhenjia.dev/api/shares/share-id-1/claim", {
    method: "POST",
    body: JSON.stringify({ claimToken: "wrong-token" }),
    headers: {
      "content-type": "application/json",
      authorization: "Bearer valid-token",
    },
  });

  const res = await claimShare("share-id-1", req, env, ctx);
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// deleteShare
// ---------------------------------------------------------------------------

test("deleteShare: returns 401 when not authenticated", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));
  const env = makeEnv();
  const ctx = makeCtx();
  const req = new Request("https://sharehtml.zhenjia.dev/api/shares/share-id-1", {
    method: "DELETE",
  });
  const res = await deleteShare("share-id-1", req, env, ctx);
  assert.equal(res.status, 401);
});

test("deleteShare: returns 404 when share not found for this user", async () => {
  vi.stubGlobal("fetch", async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-1", email: "u@test.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("profiles")) return supabaseOk([{ role: "user", banned_at: null }]);
    if (method === "PATCH") return supabaseOk([]); // no rows updated
    return supabaseOk([]);
  });

  const env = makeEnv();
  const ctx = makeCtx();
  const req = new Request("https://sharehtml.zhenjia.dev/api/shares/share-id-1", {
    method: "DELETE",
    headers: { authorization: "Bearer valid-token" },
  });

  const res = await deleteShare("share-id-1", req, env, ctx);
  assert.equal(res.status, 404);
});

test("deleteShare: returns 200 ok=true on successful deletion", async () => {
  const shareRow = makeShareRow({ lifecycle_status: "deleted" });
  vi.stubGlobal("fetch", async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-1", email: "u@test.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("profiles")) return supabaseOk([{ role: "user", banned_at: null }]);
    if (method === "PATCH") return supabaseOk([shareRow]);
    if (method === "POST" && u.includes("share_events")) return supabaseOk([{}]);
    return supabaseOk([]);
  });

  const env = makeEnv();
  const ctx = makeCtx();
  const req = new Request("https://sharehtml.zhenjia.dev/api/shares/share-id-1", {
    method: "DELETE",
    headers: { authorization: "Bearer valid-token" },
  });

  const res = await deleteShare("share-id-1", req, env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assert.equal(body.ok, true);
});

// ---------------------------------------------------------------------------
// listReports
// ---------------------------------------------------------------------------

test("listReports: returns 401 when not authenticated", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));
  const env = makeEnv();
  const req = makeRequest("https://sharehtml.zhenjia.dev/api/admin/reports");
  const res = await listReports(req, env);
  assert.equal(res.status, 401);
});

test("listReports: returns 403 for non-admin user", async () => {
  vi.stubGlobal("fetch", async (url: unknown) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-1", email: "u@test.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("profiles")) return supabaseOk([{ role: "user", banned_at: null }]);
    return supabaseOk([]);
  });
  const env = makeEnv();
  const req = makeRequest("https://sharehtml.zhenjia.dev/api/admin/reports", {}, {
    authorization: "Bearer valid-token",
  });
  const res = await listReports(req, env);
  assert.equal(res.status, 403);
});

test("listReports: returns 200 with reports for admin user", async () => {
  vi.stubGlobal("fetch", async (url: unknown) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "admin-1", email: "a@test.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("profiles")) return supabaseOk([{ role: "admin", banned_at: null }]);
    if (u.includes("reports")) return supabaseOk([{ id: "r1", status: "open" }]);
    return supabaseOk([]);
  });

  const env = makeEnv();
  const req = makeRequest("https://sharehtml.zhenjia.dev/api/admin/reports", {}, {
    authorization: "Bearer admin-token",
  });

  const res = await listReports(req, env);
  assert.equal(res.status, 200);
  const body = await res.json() as { reports: unknown[] };
  assert.ok(Array.isArray(body.reports));
});

// ---------------------------------------------------------------------------
// moderateShare
// ---------------------------------------------------------------------------

test("moderateShare: returns 403 for non-admin user", async () => {
  vi.stubGlobal("fetch", async (url: unknown) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-1", email: "u@test.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("profiles")) return supabaseOk([{ role: "user", banned_at: null }]);
    return supabaseOk([]);
  });
  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest("https://sharehtml.zhenjia.dev/api/admin/shares/share-id-1/block", {}, {
    authorization: "Bearer user-token",
  });
  const res = await moderateShare("share-id-1", "block", req, env, ctx);
  assert.equal(res.status, 403);
});

test("moderateShare: block action sets lifecycle_status to blocked", async () => {
  const shareRow = makeShareRow({ lifecycle_status: "blocked", moderation_status: "blocked" });
  let patchBody: Record<string, unknown> | undefined;

  vi.stubGlobal("fetch", async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "admin-1", email: "a@test.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("profiles")) return supabaseOk([{ role: "admin", banned_at: null }]);
    if (method === "PATCH") {
      patchBody = JSON.parse((init as RequestInit).body as string);
      return supabaseOk([shareRow]);
    }
    if (method === "POST" && u.includes("share_events")) return supabaseOk([{}]);
    return supabaseOk([]);
  });

  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest("https://sharehtml.zhenjia.dev/api/admin/shares/share-id-1/block", {}, {
    authorization: "Bearer admin-token",
  });

  const res = await moderateShare("share-id-1", "block", req, env, ctx);
  assert.equal(res.status, 200);
  assert.equal(patchBody?.lifecycle_status, "blocked");
  assert.equal(patchBody?.moderation_status, "blocked");
});

test("moderateShare: unblock action sets lifecycle_status to active", async () => {
  const shareRow = makeShareRow({ lifecycle_status: "active", moderation_status: "clean" });
  let patchBody: Record<string, unknown> | undefined;

  vi.stubGlobal("fetch", async (url: unknown, init: unknown) => {
    const u = String(url);
    const method = (init as RequestInit)?.method ?? "GET";
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "admin-1", email: "a@test.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("profiles")) return supabaseOk([{ role: "admin", banned_at: null }]);
    if (method === "PATCH") {
      patchBody = JSON.parse((init as RequestInit).body as string);
      return supabaseOk([shareRow]);
    }
    if (method === "POST" && u.includes("share_events")) return supabaseOk([{}]);
    return supabaseOk([]);
  });

  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest("https://sharehtml.zhenjia.dev/api/admin/shares/share-id-1/unblock", {}, {
    authorization: "Bearer admin-token",
  });

  const res = await moderateShare("share-id-1", "unblock", req, env, ctx);
  assert.equal(res.status, 200);
  assert.equal(patchBody?.lifecycle_status, "active");
  assert.equal(patchBody?.moderation_status, "clean");
  assert.equal(patchBody?.risk_score, 0);
});

// ---------------------------------------------------------------------------
// previewShare
// ---------------------------------------------------------------------------

function makePreviewRequest(slug: string) {
  return makeRequest(`https://sharehtml.zhenjia.dev/v/${slug}/`);
}

test("previewShare: returns HTML response for active share", async () => {
  const shareRow = makeShareRow({ lifecycle_status: "active" });
  const htmlContent = MINIMAL_HTML;

  vi.stubGlobal("fetch", async () => supabaseOk([shareRow]));

  const mockObject = {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(htmlContent));
        controller.close();
      }
    }),
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  };
  const getMock = vi.fn(async () => mockObject);
  const env = makeEnv({
    SHARE_HTML_BUCKET: { put: vi.fn(async () => {}), get: getMock },
  });
  const ctx = makeCtx();
  const req = makePreviewRequest("ABCDE12345");

  const res = await previewShare(req, env, ctx);
  assert.equal(res.status, 200);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.includes("text/html"), `expected text/html, got ${ct}`);
});

test("previewShare: returns HTML error page (404) for unknown slug", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([])); // not found
  const env = makeEnv();
  const ctx = makeCtx();
  const req = makePreviewRequest("no-such-slug");

  const res = await previewShare(req, env, ctx);
  assert.equal(res.status, 404);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.includes("text/html"), "error page should be HTML");
});

test("previewShare: returns 403 HTML error page for blocked share", async () => {
  const shareRow = makeShareRow({ lifecycle_status: "blocked" });
  vi.stubGlobal("fetch", async () => supabaseOk([shareRow]));
  const env = makeEnv();
  const ctx = makeCtx();
  const req = makePreviewRequest("ABCDE12345");

  const res = await previewShare(req, env, ctx);
  assert.equal(res.status, 403);
  const body = await res.text();
  assert.ok(body.includes("blocked by moderation"), "error body should mention blocking");
});

test("previewShare: returns 410 HTML error page for expired share", async () => {
  const expiredAt = new Date(Date.now() - 1000).toISOString(); // 1 second ago
  const shareRow = makeShareRow({ lifecycle_status: "active", expires_at: expiredAt });
  vi.stubGlobal("fetch", async () => supabaseOk([shareRow]));
  const env = makeEnv();
  const ctx = makeCtx();
  const req = makePreviewRequest("ABCDE12345");

  const res = await previewShare(req, env, ctx);
  assert.equal(res.status, 410);
});

test("previewShare: returns 404 HTML error page when R2 object is missing", async () => {
  const shareRow = makeShareRow({ lifecycle_status: "active" });
  vi.stubGlobal("fetch", async () => supabaseOk([shareRow]));
  const env = makeEnv({
    SHARE_HTML_BUCKET: { put: vi.fn(async () => {}), get: vi.fn(async () => null) },
  });
  const ctx = makeCtx();
  const req = makePreviewRequest("ABCDE12345");

  const res = await previewShare(req, env, ctx);
  assert.equal(res.status, 404);
});

test("previewShare: returns 404 for path other than index.html", async () => {
  vi.stubGlobal("fetch", async () => supabaseOk([]));
  const env = makeEnv();
  const ctx = makeCtx();
  const req = makeRequest("https://sharehtml.zhenjia.dev/v/ABCDE12345/other.html");

  const res = await previewShare(req, env, ctx);
  assert.equal(res.status, 404);
});

test("previewShare: sets content-security-policy sandbox headers", async () => {
  const shareRow = makeShareRow({ lifecycle_status: "active" });
  vi.stubGlobal("fetch", async () => supabaseOk([shareRow]));

  const htmlContent = MINIMAL_HTML;
  const mockObject = {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(htmlContent));
        controller.close();
      }
    }),
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  };
  const env = makeEnv({
    SHARE_HTML_BUCKET: { put: vi.fn(async () => {}), get: vi.fn(async () => mockObject) },
  });
  const ctx = makeCtx();
  const req = makePreviewRequest("ABCDE12345");

  const res = await previewShare(req, env, ctx);
  assert.equal(res.status, 200);
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.ok(csp.includes("default-src"), "CSP header should be present on preview response");
});
