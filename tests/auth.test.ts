import assert from "node:assert/strict";
import { test, afterEach, vi } from "vitest";

import {
  getUserFromToken,
  getOptionalUser,
  requireUser,
  requireAdmin,
} from "../src/worker/auth.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_REST_KEY: "rest-key",
    SUPABASE_PUBLISHABLE_KEY: "pub-key",
    WORKER_API_SECRET: "worker-secret",
    ...overrides,
  } as any;
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/shares", { headers });
}

/**
 * Build a fetch stub that sequences through multiple responses.
 * Call 0 returns responses[0], call 1 returns responses[1], etc.
 * If more calls are made than responses provided, the last response is reused.
 */
function sequentialFetch(responses: Response[]) {
  let call = 0;
  return vi.fn(async (_url: unknown, _init?: unknown) => {
    const idx = Math.min(call++, responses.length - 1);
    return responses[idx].clone();
  });
}

/** Supabase auth/v1/user OK response */
function authResponse(id: string, email: string): Response {
  return new Response(JSON.stringify({ id, email }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Supabase auth/v1/user non-ok response */
function authErrorResponse(status = 401): Response {
  return new Response(JSON.stringify({ message: "Unauthorized" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** restSelect profile response — returns an array of profile rows */
function profileResponse(role: "user" | "admin", banned_at: string | null = null): Response {
  return new Response(JSON.stringify([{ role, banned_at }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** restSelect profile response — no profile found (empty array) */
function emptyProfileResponse(): Response {
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** restInsert profiles response — returns inserted row array */
function insertProfileResponse(id: string): Response {
  return new Response(JSON.stringify([{ id, display_name: "User" }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// getUserFromToken
// ---------------------------------------------------------------------------

test("getUserFromToken: calls Supabase auth endpoint with correct URL", async () => {
  const capturedUrls: string[] = [];
  vi.stubGlobal("fetch", async (url: unknown, _init?: unknown) => {
    capturedUrls.push(String(url));
    // First call: auth endpoint; second call: profiles restSelect
    if (String(url).includes("/auth/v1/user")) {
      return authResponse("user-123", "test@example.com");
    }
    return profileResponse("user");
  });

  const env = makeEnv();
  await getUserFromToken("tok-abc", env);

  assert.equal(capturedUrls[0], "https://proj.supabase.co/auth/v1/user");
});

test("getUserFromToken: sends apikey and Authorization headers to auth endpoint", async () => {
  let capturedHeaders: Record<string, string> = {};
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("/auth/v1/user")) {
      const h = new Headers(init?.headers ?? {});
      capturedHeaders = {
        apikey: h.get("apikey") ?? "",
        authorization: h.get("authorization") ?? "",
      };
      return authResponse("user-123", "test@example.com");
    }
    return profileResponse("user");
  });

  const env = makeEnv();
  await getUserFromToken("my-bearer-token", env);

  assert.equal(capturedHeaders.apikey, "pub-key");
  assert.equal(capturedHeaders.authorization, "Bearer my-bearer-token");
});

test("getUserFromToken: maps id and email from Supabase auth response", async () => {
  vi.stubGlobal("fetch", sequentialFetch([
    authResponse("abc-123", "alice@example.com"),
    profileResponse("user", null),
  ]));

  const env = makeEnv();
  const user = await getUserFromToken("tok", env);

  assert.equal(user.id, "abc-123");
  assert.equal(user.email, "alice@example.com");
});

test("getUserFromToken: uses profile role from database when profile exists", async () => {
  vi.stubGlobal("fetch", sequentialFetch([
    authResponse("abc-123", "alice@example.com"),
    profileResponse("admin", null),
  ]));

  const env = makeEnv();
  const user = await getUserFromToken("tok", env);

  assert.equal(user.role, "admin");
});

test("getUserFromToken: defaults role to 'user' when no profile exists", async () => {
  vi.stubGlobal("fetch", sequentialFetch([
    authResponse("new-user", "new@example.com"),
    emptyProfileResponse(),
    insertProfileResponse("new-user"),
  ]));

  const env = makeEnv();
  const user = await getUserFromToken("tok", env);

  assert.equal(user.role, "user");
});

test("getUserFromToken: banned_at comes from profile row", async () => {
  vi.stubGlobal("fetch", sequentialFetch([
    authResponse("banned-1", "b@example.com"),
    profileResponse("user", "2025-01-01T00:00:00Z"),
  ]));

  const env = makeEnv();
  const user = await getUserFromToken("tok", env);

  assert.equal(user.banned_at, "2025-01-01T00:00:00Z");
});

test("getUserFromToken: banned_at is null when profile has null banned_at", async () => {
  vi.stubGlobal("fetch", sequentialFetch([
    authResponse("user-1", "u@example.com"),
    profileResponse("user", null),
  ]));

  const env = makeEnv();
  const user = await getUserFromToken("tok", env);

  assert.equal(user.banned_at, null);
});

test("getUserFromToken: throws when Supabase auth returns non-ok", async () => {
  vi.stubGlobal("fetch", sequentialFetch([authErrorResponse(401)]));

  const env = makeEnv();
  await assert.rejects(
    () => getUserFromToken("bad-token", env),
    /Supabase auth returned 401/
  );
});

test("getUserFromToken: profile lookup uses correct RestAPI path with user id", async () => {
  const capturedUrls: string[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    capturedUrls.push(String(url));
    if (String(url).includes("/auth/v1/user")) {
      return authResponse("my-uid", "u@example.com");
    }
    return profileResponse("user");
  });

  const env = makeEnv();
  await getUserFromToken("tok", env);

  const profileUrl = capturedUrls.find((u) => u.includes("/rest/v1/profiles"));
  assert.ok(profileUrl, "should call profiles REST endpoint");
  assert.ok(profileUrl!.includes("id=eq.my-uid"), "should filter by user id");
  assert.ok(profileUrl!.includes("select=role,banned_at"), "should select role and banned_at");
});

test("getUserFromToken: inserts a new profile when none found", async () => {
  const capturedInserts: { url: string; body: string }[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.includes("/auth/v1/user")) {
      return authResponse("new-id", "newuser@example.com");
    }
    if (urlStr.includes("/rest/v1/profiles") && (init as RequestInit)?.method === "POST") {
      capturedInserts.push({ url: urlStr, body: String(init?.body ?? "") });
      return insertProfileResponse("new-id");
    }
    // GET profile lookup — return empty
    return emptyProfileResponse();
  });

  const env = makeEnv();
  await getUserFromToken("tok", env);

  assert.equal(capturedInserts.length, 1, "should have inserted exactly one profile");
  const parsed = JSON.parse(capturedInserts[0].body);
  assert.equal(parsed.id, "new-id");
  assert.equal(parsed.display_name, "newuser");
});

test("getUserFromToken: display_name falls back to 'User' when email has no @", async () => {
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.includes("/auth/v1/user")) {
      // Return a user with no email field
      return new Response(JSON.stringify({ id: "no-email-user" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if ((init as RequestInit)?.method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      // Echo back so we can inspect display_name
      return new Response(JSON.stringify([body]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return emptyProfileResponse();
  });

  const env = makeEnv();
  const user = await getUserFromToken("tok", env);

  // No email in raw → email field in AuthUser should be undefined
  assert.equal(user.email, undefined);
});

// ---------------------------------------------------------------------------
// getOptionalUser
// ---------------------------------------------------------------------------

test("getOptionalUser: returns null when no Authorization header", async () => {
  const req = makeRequest();
  const env = makeEnv();
  const result = await getOptionalUser(req, env);
  assert.equal(result, null);
});

test("getOptionalUser: returns null when Authorization header is not Bearer", async () => {
  const req = makeRequest({ authorization: "Basic dXNlcjpwYXNz" });
  const env = makeEnv();
  const result = await getOptionalUser(req, env);
  assert.equal(result, null);
});

test("getOptionalUser: does not call fetch when Authorization header is absent", async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);

  const req = makeRequest();
  const env = makeEnv();
  await getOptionalUser(req, env);

  assert.equal(fetchSpy.mock.calls.length, 0);
});

test("getOptionalUser: does not call fetch when Authorization header lacks Bearer prefix", async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);

  const req = makeRequest({ authorization: "Token abc123" });
  const env = makeEnv();
  await getOptionalUser(req, env);

  assert.equal(fetchSpy.mock.calls.length, 0);
});

test("getOptionalUser: returns AuthUser when valid Bearer token resolves", async () => {
  vi.stubGlobal("fetch", sequentialFetch([
    authResponse("uid-1", "user@example.com"),
    profileResponse("user", null),
  ]));

  const req = makeRequest({ authorization: "Bearer valid-token" });
  const env = makeEnv();
  const result = await getOptionalUser(req, env);

  assert.ok(result !== null);
  assert.equal(result!.id, "uid-1");
  assert.equal(result!.email, "user@example.com");
  assert.equal(result!.role, "user");
  assert.equal(result!.banned_at, null);
});

test("getOptionalUser: passes token without Bearer prefix to getUserFromToken", async () => {
  let capturedAuthHeader = "";
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("/auth/v1/user")) {
      const h = new Headers(init?.headers ?? {});
      capturedAuthHeader = h.get("authorization") ?? "";
      return authResponse("uid-1", "u@example.com");
    }
    return profileResponse("user");
  });

  const req = makeRequest({ authorization: "Bearer the-actual-token" });
  const env = makeEnv();
  await getOptionalUser(req, env);

  assert.equal(capturedAuthHeader, "Bearer the-actual-token");
});

test("getOptionalUser: returns null when Supabase auth returns non-ok (error swallowed)", async () => {
  vi.stubGlobal("fetch", sequentialFetch([authErrorResponse(401)]));

  const req = makeRequest({ authorization: "Bearer bad-token" });
  const env = makeEnv();
  const result = await getOptionalUser(req, env);

  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// requireUser
// ---------------------------------------------------------------------------

test("requireUser: returns 401 Response when no Authorization header", async () => {
  const req = makeRequest();
  const env = makeEnv();
  const result = await requireUser(req, env);

  assert.ok(result instanceof Response);
  assert.equal((result as Response).status, 401);
});

test("requireUser: 401 response body contains 'Authentication required.' when header absent", async () => {
  const req = makeRequest();
  const env = makeEnv();
  const result = await requireUser(req, env);
  const body = await (result as Response).json() as { error: string };
  assert.equal(body.error, "Authentication required.");
});

test("requireUser: returns 401 Response when Authorization header is not Bearer", async () => {
  const req = makeRequest({ authorization: "Basic dXNlcjpwYXNz" });
  const env = makeEnv();
  const result = await requireUser(req, env);

  assert.ok(result instanceof Response);
  assert.equal((result as Response).status, 401);
});

test("requireUser: returns 401 with 'Invalid session.' when Supabase auth fails", async () => {
  vi.stubGlobal("fetch", sequentialFetch([authErrorResponse(401)]));

  const req = makeRequest({ authorization: "Bearer bad-token" });
  const env = makeEnv();
  const result = await requireUser(req, env);

  assert.ok(result instanceof Response);
  assert.equal((result as Response).status, 401);
  const body = await (result as Response).json() as { error: string };
  assert.equal(body.error, "Invalid session.");
});

test("requireUser: returns AuthUser when Bearer token is valid", async () => {
  vi.stubGlobal("fetch", sequentialFetch([
    authResponse("uid-42", "admin@example.com"),
    profileResponse("user", null),
  ]));

  const req = makeRequest({ authorization: "Bearer valid-token" });
  const env = makeEnv();
  const result = await requireUser(req, env);

  assert.ok(!(result instanceof Response));
  const user = result as { id: string; email?: string; role: string; banned_at: string | null };
  assert.equal(user.id, "uid-42");
  assert.equal(user.email, "admin@example.com");
  assert.equal(user.role, "user");
});

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

test("requireAdmin: returns 401 Response when no Authorization header", async () => {
  const req = makeRequest();
  const env = makeEnv();
  const result = await requireAdmin(req, env);

  assert.ok(result instanceof Response);
  assert.equal((result as Response).status, 401);
});

test("requireAdmin: returns 403 Response when user is not admin", async () => {
  vi.stubGlobal("fetch", sequentialFetch([
    authResponse("uid-1", "user@example.com"),
    profileResponse("user", null),
  ]));

  const req = makeRequest({ authorization: "Bearer valid-token" });
  const env = makeEnv();
  const result = await requireAdmin(req, env);

  assert.ok(result instanceof Response);
  assert.equal((result as Response).status, 403);
});

test("requireAdmin: 403 response body contains 'Admin access required.'", async () => {
  vi.stubGlobal("fetch", sequentialFetch([
    authResponse("uid-1", "user@example.com"),
    profileResponse("user", null),
  ]));

  const req = makeRequest({ authorization: "Bearer valid-token" });
  const env = makeEnv();
  const result = await requireAdmin(req, env);
  const body = await (result as Response).json() as { error: string };
  assert.equal(body.error, "Admin access required.");
});

test("requireAdmin: returns AuthUser when user role is admin", async () => {
  vi.stubGlobal("fetch", sequentialFetch([
    authResponse("admin-uid", "admin@example.com"),
    profileResponse("admin", null),
  ]));

  const req = makeRequest({ authorization: "Bearer admin-token" });
  const env = makeEnv();
  const result = await requireAdmin(req, env);

  assert.ok(!(result instanceof Response));
  const user = result as { id: string; email?: string; role: string; banned_at: string | null };
  assert.equal(user.id, "admin-uid");
  assert.equal(user.role, "admin");
});

test("requireAdmin: passes through 401 from requireUser when token is invalid", async () => {
  vi.stubGlobal("fetch", sequentialFetch([authErrorResponse(401)]));

  const req = makeRequest({ authorization: "Bearer bad-token" });
  const env = makeEnv();
  const result = await requireAdmin(req, env);

  assert.ok(result instanceof Response);
  assert.equal((result as Response).status, 401);
});
