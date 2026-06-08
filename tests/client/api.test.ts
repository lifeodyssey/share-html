/**
 * @vitest-environment node
 *
 * Pure fetch-logic tests for the typed API client.
 * We stub the global fetch and assert that each function builds the correct
 * URL / method / headers / body and correctly parses (or rejects) the response.
 */
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import {
  fetchConfig,
  uploadShare,
  listShares,
  deleteShare,
  claimShare,
  fetchPublicShare,
  reportShare,
} from "../../src/client/api.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errJson(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type CapturedRequest = {
  url: string;
  init?: RequestInit;
};

function stubFetch(response: Response): { captured: () => CapturedRequest } {
  let captured: CapturedRequest = { url: "" };
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    captured = { url: String(url), init };
    return response;
  });
  return { captured: () => captured };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// fetchConfig
// ---------------------------------------------------------------------------

test("fetchConfig: GET /api/config and returns parsed config", async () => {
  const payload = { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "pk" };
  const { captured } = stubFetch(okJson(payload));

  const result = await fetchConfig();

  assert.equal(captured().url, "/api/config");
  assert.deepEqual(result, payload);
});

test("fetchConfig: throws when response is not ok", async () => {
  stubFetch(new Response("", { status: 503 }));

  await assert.rejects(fetchConfig(), /Config unavailable/);
});

// ---------------------------------------------------------------------------
// uploadShare
// ---------------------------------------------------------------------------

test("uploadShare: POST /api/shares with form data and no auth header when no token", async () => {
  const payload = {
    share: { id: "s1", slug: "abc" },
    claimToken: "tok",
    message: "ok",
  };
  const { captured } = stubFetch(okJson(payload));
  const file = new File(["<h1>hi</h1>"], "index.html", { type: "text/html" });

  await uploadShare(file, "My Share");

  assert.equal(captured().url, "/api/shares");
  assert.equal(captured().init?.method, "POST");
  assert.ok(captured().init?.headers === undefined);
  const body = captured().init?.body as FormData;
  assert.ok(body instanceof FormData);
  assert.equal(body.get("title"), "My Share");
  assert.equal((body.get("file") as File).name, "index.html");
});

test("uploadShare: includes Bearer authorization header when accessToken provided", async () => {
  const payload = { share: { id: "s2", slug: "xyz" }, claimToken: null, message: "ok" };
  const { captured } = stubFetch(okJson(payload));
  const file = new File(["<p>hi</p>"], "index.html", { type: "text/html" });

  await uploadShare(file, "Auth Share", "my-token");

  const headers = captured().init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer my-token");
});

test("uploadShare: throws with error message when response is not ok", async () => {
  stubFetch(errJson({ error: "File too large" }));
  const file = new File(["x"], "index.html", { type: "text/html" });

  await assert.rejects(uploadShare(file, ""), /File too large/);
});

test("uploadShare: falls back to 'Upload failed' when no error field", async () => {
  stubFetch(errJson({}));
  const file = new File(["x"], "index.html", { type: "text/html" });

  await assert.rejects(uploadShare(file, ""), /Upload failed/);
});

// ---------------------------------------------------------------------------
// listShares
// ---------------------------------------------------------------------------

test("listShares: GET /api/shares with Bearer authorization header", async () => {
  const shares = [{ id: "s1" }, { id: "s2" }];
  const { captured } = stubFetch(okJson({ shares }));

  const result = await listShares("user-token");

  assert.equal(captured().url, "/api/shares");
  assert.equal(captured().init?.method, undefined); // default GET, no explicit method
  const headers = captured().init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer user-token");
  assert.deepEqual(result, shares);
});

test("listShares: returns empty array when shares field is missing", async () => {
  stubFetch(okJson({}));
  const result = await listShares("token");
  assert.deepEqual(result, []);
});

test("listShares: throws when response is not ok", async () => {
  stubFetch(errJson({ error: "Unauthorized" }));
  await assert.rejects(listShares("bad-token"), /Unauthorized/);
});

// ---------------------------------------------------------------------------
// deleteShare
// ---------------------------------------------------------------------------

test("deleteShare: DELETE /api/shares/:id with authorization header", async () => {
  const { captured } = stubFetch(new Response("", { status: 200 }));

  await deleteShare("share-id-1", "del-token");

  assert.equal(captured().url, "/api/shares/share-id-1");
  assert.equal(captured().init?.method, "DELETE");
  const headers = captured().init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer del-token");
});

test("deleteShare: throws when response is not ok", async () => {
  stubFetch(new Response("", { status: 403 }));
  await assert.rejects(deleteShare("id", "token"), /Delete failed/);
});

// ---------------------------------------------------------------------------
// claimShare
// ---------------------------------------------------------------------------

test("claimShare: POST /api/shares/:id/claim with JSON body and auth header", async () => {
  const { captured } = stubFetch(okJson({}));

  await claimShare("share-99", "claim-tok", "user-jwt");

  assert.equal(captured().url, "/api/shares/share-99/claim");
  assert.equal(captured().init?.method, "POST");
  const headers = captured().init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer user-jwt");
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(captured().init?.body as string), { claimToken: "claim-tok" });
});

test("claimShare: throws with error from payload when response is not ok", async () => {
  stubFetch(errJson({ error: "Invalid claim token" }));
  await assert.rejects(claimShare("id", "bad", "tok"), /Invalid claim token/);
});

test("claimShare: falls back to 'Claim failed.' when no error field", async () => {
  stubFetch(errJson({}));
  await assert.rejects(claimShare("id", "tok", "jwt"), /Claim failed/);
});

// ---------------------------------------------------------------------------
// fetchPublicShare
// ---------------------------------------------------------------------------

test("fetchPublicShare: GET /api/public/shares/:slug and returns share", async () => {
  const share = { id: "pub1", slug: "my-slug" };
  const { captured } = stubFetch(okJson({ share }));

  const result = await fetchPublicShare("my-slug");

  assert.equal(captured().url, "/api/public/shares/my-slug");
  assert.deepEqual(result, share);
});

test("fetchPublicShare: throws when response is not ok", async () => {
  stubFetch(errJson({ error: "Share not found" }));
  await assert.rejects(fetchPublicShare("missing"), /Share not found/);
});

test("fetchPublicShare: throws when share field is missing even on 200", async () => {
  stubFetch(okJson({}));
  await assert.rejects(fetchPublicShare("slug"), /Share not found/);
});

// ---------------------------------------------------------------------------
// reportShare
// ---------------------------------------------------------------------------

test("reportShare: POST /api/shares/:id/report with JSON body, no auth when no token", async () => {
  const { captured } = stubFetch(new Response("", { status: 200 }));

  await reportShare("share-42", "phishing", "Looks bad");

  assert.equal(captured().url, "/api/shares/share-42/report");
  assert.equal(captured().init?.method, "POST");
  const headers = captured().init?.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers.authorization, undefined);
  assert.deepEqual(JSON.parse(captured().init?.body as string), {
    reason: "phishing",
    details: "Looks bad",
  });
});

test("reportShare: includes authorization header when accessToken provided", async () => {
  const { captured } = stubFetch(new Response("", { status: 200 }));

  await reportShare("share-42", "malware", "", "reporter-jwt");

  const headers = captured().init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer reporter-jwt");
});

test("reportShare: throws when response is not ok", async () => {
  stubFetch(new Response("", { status: 500 }));
  await assert.rejects(reportShare("id", "other", ""), /Report failed/);
});
