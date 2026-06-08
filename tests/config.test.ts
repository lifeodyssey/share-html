import assert from "node:assert/strict";
import { test } from "vitest";

import { appOrigin, maxUploadBytes, previewOrigin } from "../src/worker/config.ts";

// ---------------------------------------------------------------------------
// maxUploadBytes
// ---------------------------------------------------------------------------

test("maxUploadBytes: anonymous user gets 1 MB default when env is empty", () => {
  assert.equal(maxUploadBytes({}, false), 1024 * 1024);
});

test("maxUploadBytes: authenticated user gets 5 MB default when env is empty", () => {
  assert.equal(maxUploadBytes({}, true), 5 * 1024 * 1024);
});

test("maxUploadBytes: anonymous user reads MAX_ANON_HTML_BYTES from env", () => {
  assert.equal(maxUploadBytes({ MAX_ANON_HTML_BYTES: "2097152" }, false), 2097152);
});

test("maxUploadBytes: authenticated user reads MAX_USER_HTML_BYTES from env", () => {
  assert.equal(maxUploadBytes({ MAX_USER_HTML_BYTES: "10485760" }, true), 10485760);
});

test("maxUploadBytes: anonymous user ignores MAX_USER_HTML_BYTES", () => {
  // Anonymous should NOT be affected by the user limit env var
  assert.equal(maxUploadBytes({ MAX_USER_HTML_BYTES: "9999" }, false), 1024 * 1024);
});

test("maxUploadBytes: authenticated user ignores MAX_ANON_HTML_BYTES", () => {
  // Authenticated should NOT be affected by the anon limit env var
  assert.equal(maxUploadBytes({ MAX_ANON_HTML_BYTES: "9999" }, true), 5 * 1024 * 1024);
});

test("maxUploadBytes: falls back to default when env value is not a valid number", () => {
  assert.equal(maxUploadBytes({ MAX_ANON_HTML_BYTES: "not-a-number" }, false), 1024 * 1024);
  assert.equal(maxUploadBytes({ MAX_USER_HTML_BYTES: "NaN" }, true), 5 * 1024 * 1024);
});

test("maxUploadBytes: falls back to default when env value is empty string", () => {
  assert.equal(maxUploadBytes({ MAX_ANON_HTML_BYTES: "" }, false), 1024 * 1024);
  assert.equal(maxUploadBytes({ MAX_USER_HTML_BYTES: "" }, true), 5 * 1024 * 1024);
});

test("maxUploadBytes: accepts custom values for both user types simultaneously", () => {
  const env = { MAX_ANON_HTML_BYTES: "512000", MAX_USER_HTML_BYTES: "8388608" };
  assert.equal(maxUploadBytes(env, false), 512000);
  assert.equal(maxUploadBytes(env, true), 8388608);
});

// ---------------------------------------------------------------------------
// appOrigin
// ---------------------------------------------------------------------------

test("appOrigin: returns APP_ORIGIN from env when set", () => {
  assert.equal(
    appOrigin({ APP_ORIGIN: "https://sharehtml.example.com" }, "https://worker.example.com"),
    "https://sharehtml.example.com"
  );
});

test("appOrigin: falls back to requestOrigin when APP_ORIGIN is not set", () => {
  assert.equal(
    appOrigin({}, "https://worker.example.com"),
    "https://worker.example.com"
  );
});

test("appOrigin: falls back to requestOrigin when APP_ORIGIN is empty string", () => {
  assert.equal(
    appOrigin({ APP_ORIGIN: "" }, "https://worker.example.com"),
    "https://worker.example.com"
  );
});

// ---------------------------------------------------------------------------
// previewOrigin
// ---------------------------------------------------------------------------

test("previewOrigin: returns PREVIEW_ORIGIN from env when set", () => {
  assert.equal(
    previewOrigin({ PREVIEW_ORIGIN: "https://preview.example.com" }, "https://worker.example.com"),
    "https://preview.example.com"
  );
});

test("previewOrigin: falls back to requestOrigin when PREVIEW_ORIGIN is not set", () => {
  assert.equal(
    previewOrigin({}, "https://worker.example.com"),
    "https://worker.example.com"
  );
});

test("previewOrigin: falls back to requestOrigin when PREVIEW_ORIGIN is empty string", () => {
  assert.equal(
    previewOrigin({ PREVIEW_ORIGIN: "" }, "https://worker.example.com"),
    "https://worker.example.com"
  );
});

test("previewOrigin: can be different from appOrigin in same env", () => {
  const env = {
    APP_ORIGIN: "https://sharehtml.example.com",
    PREVIEW_ORIGIN: "https://preview.example.com",
  };
  const fallback = "https://worker.example.com";
  assert.equal(appOrigin(env, fallback), "https://sharehtml.example.com");
  assert.equal(previewOrigin(env, fallback), "https://preview.example.com");
});
