import assert from "node:assert/strict";
import { test } from "vitest";

import {
  acceptsMarkdown,
  corsHeaders,
  json,
  jsonResponse,
  methodNotAllowed,
  readJson,
  textResponse,
  withDiscoveryHeaders,
} from "../src/worker/http.ts";

import { DISCOVERY_LINKS } from "../src/worker/constants.ts";

// ---------------------------------------------------------------------------
// json
// ---------------------------------------------------------------------------

test("json: returns a Response", () => {
  const r = json({ ok: true });
  assert.ok(r instanceof Response);
});

test("json: default status is 200", () => {
  const r = json({ ok: true });
  assert.equal(r.status, 200);
});

test("json: accepts explicit status", () => {
  const r = json({ error: "bad" }, 422);
  assert.equal(r.status, 422);
});

test("json: content-type is application/json; charset=utf-8", () => {
  const r = json({ x: 1 });
  assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
});

test("json: body is JSON-stringified (no pretty-printing)", async () => {
  const r = json({ a: 1, b: "two" });
  const text = await r.text();
  assert.equal(text, JSON.stringify({ a: 1, b: "two" }));
});

test("json: adds Link discovery header", () => {
  const r = json({});
  const link = r.headers.get("Link");
  assert.ok(link !== null, "Link header must be present");
  assert.ok(link!.includes("api-catalog"), "Link header should include api-catalog");
  assert.equal(link, DISCOVERY_LINKS);
});

test("json: adds X-Content-Type-Options: nosniff", () => {
  const r = json({});
  assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
});

// ---------------------------------------------------------------------------
// textResponse
// ---------------------------------------------------------------------------

test("textResponse: status is 200", () => {
  const r = textResponse("hello", "text/plain; charset=utf-8", "GET");
  assert.equal(r.status, 200);
});

test("textResponse: content-type matches provided argument", async () => {
  const r = textResponse("hello", "text/plain; charset=utf-8", "GET");
  assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8");
});

test("textResponse: body is the provided string for GET", async () => {
  const r = textResponse("hello world", "text/plain; charset=utf-8", "GET");
  const text = await r.text();
  assert.equal(text, "hello world");
});

test("textResponse: body is null for HEAD", async () => {
  const r = textResponse("hello", "text/plain; charset=utf-8", "HEAD");
  const text = await r.text();
  assert.equal(text, "");
});

test("textResponse: cache-control header is present", () => {
  const r = textResponse("x", "text/plain; charset=utf-8", "GET");
  const cc = r.headers.get("cache-control");
  assert.ok(cc !== null, "cache-control must be present");
  assert.equal(cc, "public, max-age=3600");
});

test("textResponse: content-type for markdown variant", () => {
  const r = textResponse("# md", "text/markdown; charset=utf-8", "GET");
  assert.equal(r.headers.get("content-type"), "text/markdown; charset=utf-8");
});

// ---------------------------------------------------------------------------
// jsonResponse
// ---------------------------------------------------------------------------

test("jsonResponse: status is 200", () => {
  const r = jsonResponse({ a: 1 }, "application/json; charset=utf-8", "GET");
  assert.equal(r.status, 200);
});

test("jsonResponse: content-type matches provided argument", () => {
  const r = jsonResponse({}, "application/openapi+json; charset=utf-8", "GET");
  assert.equal(r.headers.get("content-type"), "application/openapi+json; charset=utf-8");
});

test("jsonResponse: body is pretty-printed JSON (2-space indent)", async () => {
  const r = jsonResponse({ a: 1 }, "application/json; charset=utf-8", "GET");
  const text = await r.text();
  assert.equal(text, JSON.stringify({ a: 1 }, null, 2));
});

test("jsonResponse: body is empty for HEAD", async () => {
  const r = jsonResponse({ a: 1 }, "application/json; charset=utf-8", "HEAD");
  const text = await r.text();
  assert.equal(text, "");
});

test("jsonResponse: cache-control is public, max-age=3600", () => {
  const r = jsonResponse({}, "application/json; charset=utf-8", "GET");
  assert.equal(r.headers.get("cache-control"), "public, max-age=3600");
});

// ---------------------------------------------------------------------------
// methodNotAllowed
// ---------------------------------------------------------------------------

test("methodNotAllowed: status is 405", () => {
  const r = methodNotAllowed("GET, POST");
  assert.equal(r.status, 405);
});

test("methodNotAllowed: Allow header equals the provided string", () => {
  const r = methodNotAllowed("POST");
  assert.equal(r.headers.get("Allow"), "POST");
});

test("methodNotAllowed: Allow header with multiple methods", () => {
  const r = methodNotAllowed("GET, HEAD, POST");
  assert.equal(r.headers.get("Allow"), "GET, HEAD, POST");
});

test("methodNotAllowed: adds Link discovery header via withDiscoveryHeaders", () => {
  const r = methodNotAllowed("GET");
  assert.ok(r.headers.get("Link") !== null, "Link header must be present");
});

test("methodNotAllowed: adds X-Content-Type-Options: nosniff", () => {
  const r = methodNotAllowed("GET");
  assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
});

// ---------------------------------------------------------------------------
// corsHeaders
// ---------------------------------------------------------------------------

test("corsHeaders: returns a Headers instance", () => {
  const req = new Request("https://example.com/api/foo", {
    headers: { Origin: "https://app.example.com" }
  });
  const h = corsHeaders(req);
  assert.ok(h instanceof Headers);
});

test("corsHeaders: access-control-allow-origin echoes the Origin header", () => {
  const req = new Request("https://example.com/api/foo", {
    headers: { Origin: "https://app.example.com" }
  });
  const h = corsHeaders(req);
  assert.equal(h.get("access-control-allow-origin"), "https://app.example.com");
});

test("corsHeaders: access-control-allow-origin is * when no Origin header", () => {
  const req = new Request("https://example.com/api/foo");
  const h = corsHeaders(req);
  assert.equal(h.get("access-control-allow-origin"), "*");
});

test("corsHeaders: access-control-allow-methods is GET,POST,PATCH,DELETE,OPTIONS", () => {
  const req = new Request("https://example.com/api/foo");
  const h = corsHeaders(req);
  assert.equal(h.get("access-control-allow-methods"), "GET,POST,PATCH,DELETE,OPTIONS");
});

test("corsHeaders: access-control-allow-headers is authorization,content-type", () => {
  const req = new Request("https://example.com/api/foo");
  const h = corsHeaders(req);
  assert.equal(h.get("access-control-allow-headers"), "authorization,content-type");
});

test("corsHeaders: content-type is application/json; charset=utf-8", () => {
  const req = new Request("https://example.com/api/foo");
  const h = corsHeaders(req);
  assert.equal(h.get("content-type"), "application/json; charset=utf-8");
});

// ---------------------------------------------------------------------------
// acceptsMarkdown
// ---------------------------------------------------------------------------

test("acceptsMarkdown: true when Accept includes text/markdown and method is GET", () => {
  const req = new Request("https://example.com/", {
    method: "GET",
    headers: { Accept: "text/markdown" }
  });
  assert.equal(acceptsMarkdown(req), true);
});

test("acceptsMarkdown: true when Accept includes text/markdown and method is HEAD", () => {
  const req = new Request("https://example.com/", {
    method: "HEAD",
    headers: { Accept: "text/markdown, text/html" }
  });
  assert.equal(acceptsMarkdown(req), true);
});

test("acceptsMarkdown: false when method is POST even with text/markdown Accept", () => {
  const req = new Request("https://example.com/", {
    method: "POST",
    headers: { Accept: "text/markdown" }
  });
  assert.equal(acceptsMarkdown(req), false);
});

test("acceptsMarkdown: false when Accept does not include text/markdown", () => {
  const req = new Request("https://example.com/", {
    method: "GET",
    headers: { Accept: "text/html, application/json" }
  });
  assert.equal(acceptsMarkdown(req), false);
});

test("acceptsMarkdown: false when no Accept header", () => {
  const req = new Request("https://example.com/", { method: "GET" });
  assert.equal(acceptsMarkdown(req), false);
});

test("acceptsMarkdown: case-insensitive — TEXT/MARKDOWN is accepted", () => {
  const req = new Request("https://example.com/", {
    method: "GET",
    headers: { Accept: "TEXT/MARKDOWN" }
  });
  assert.equal(acceptsMarkdown(req), true);
});

// ---------------------------------------------------------------------------
// withDiscoveryHeaders
// ---------------------------------------------------------------------------

test("withDiscoveryHeaders: preserves response status", () => {
  const original = new Response("body", { status: 201 });
  const r = withDiscoveryHeaders(original);
  assert.equal(r.status, 201);
});

test("withDiscoveryHeaders: preserves response statusText", () => {
  const original = new Response("body", { status: 200, statusText: "OK" });
  const r = withDiscoveryHeaders(original);
  assert.equal(r.statusText, "OK");
});

test("withDiscoveryHeaders: adds Link header equal to DISCOVERY_LINKS", () => {
  const original = new Response("body");
  const r = withDiscoveryHeaders(original);
  assert.equal(r.headers.get("Link"), DISCOVERY_LINKS);
});

test("withDiscoveryHeaders: appends to existing Link header", () => {
  const original = new Response("body", {
    headers: { Link: "</existing>; rel=prev" }
  });
  const r = withDiscoveryHeaders(original);
  const link = r.headers.get("Link");
  assert.ok(link!.startsWith("</existing>; rel=prev, "), "should prepend existing Link");
  assert.ok(link!.includes(DISCOVERY_LINKS), "should include DISCOVERY_LINKS");
});

test("withDiscoveryHeaders: sets X-Content-Type-Options to nosniff when not already set", () => {
  const original = new Response("body");
  const r = withDiscoveryHeaders(original);
  assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
});

test("withDiscoveryHeaders: preserves existing X-Content-Type-Options value", () => {
  const original = new Response("body", {
    headers: { "X-Content-Type-Options": "nosniff" }
  });
  const r = withDiscoveryHeaders(original);
  assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
});

test("withDiscoveryHeaders: preserves response body", async () => {
  const original = new Response("hello body");
  const r = withDiscoveryHeaders(original);
  const text = await r.text();
  assert.equal(text, "hello body");
});

// ---------------------------------------------------------------------------
// readJson
// ---------------------------------------------------------------------------

test("readJson: parses valid JSON body", async () => {
  const req = new Request("https://example.com/api/foo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "value" })
  });
  const result = await readJson<{ key: string }>(req);
  assert.deepEqual(result, { key: "value" });
});

test("readJson: returns empty object for invalid JSON", async () => {
  const req = new Request("https://example.com/api/foo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json"
  });
  const result = await readJson<Record<string, unknown>>(req);
  assert.deepEqual(result, {});
});

test("readJson: returns empty object for empty body", async () => {
  const req = new Request("https://example.com/api/foo", {
    method: "POST",
    body: ""
  });
  const result = await readJson<Record<string, unknown>>(req);
  assert.deepEqual(result, {});
});

test("readJson: parses nested JSON", async () => {
  const payload = { a: { b: [1, 2, 3] } };
  const req = new Request("https://example.com/api/foo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await readJson<typeof payload>(req);
  assert.deepEqual(result, payload);
});
