import assert from "node:assert/strict";
import { test, vi } from "vitest";

import {
  base64Url,
  cleanTitle,
  errorMessage,
  formatBytes,
  getClientIp,
  hashText,
  logBackgroundError,
  looksLikeHtml,
  numberEnv,
  sanitizeShortText,
  sha256Hex,
} from "../src/worker/utils.ts";

// ---------------------------------------------------------------------------
// looksLikeHtml
// ---------------------------------------------------------------------------

test("looksLikeHtml: returns true for <!doctype html", () => {
  assert.equal(looksLikeHtml("<!doctype html><html><body></body></html>"), true);
});

test("looksLikeHtml: returns true for <html> tag", () => {
  assert.equal(looksLikeHtml("<html><body></body></html>"), true);
});

test("looksLikeHtml: returns true for <body> tag", () => {
  assert.equal(looksLikeHtml("<body><p>hi</p></body>"), true);
});

test("looksLikeHtml: returns true for <script> tag", () => {
  assert.equal(looksLikeHtml("<script>alert(1)</script>"), true);
});

test("looksLikeHtml: returns false for plain text without html markers", () => {
  assert.equal(looksLikeHtml("Hello, world! This is plain text."), false);
});

test("looksLikeHtml: returns false for JSON", () => {
  assert.equal(looksLikeHtml('{"key": "value"}'), false);
});

test("looksLikeHtml: is case-insensitive — uppercase DOCTYPE", () => {
  assert.equal(looksLikeHtml("<!DOCTYPE HTML><HTML><BODY></BODY></HTML>"), true);
});

// ---------------------------------------------------------------------------
// cleanTitle
// ---------------------------------------------------------------------------

test("cleanTitle: uses provided title when non-empty", () => {
  const html = "<!doctype html><html><head><title>Extracted</title></head><body></body></html>";
  assert.equal(cleanTitle("My Custom Title", html), "My Custom Title");
});

test("cleanTitle: falls back to <title> extraction when provided title is empty string", () => {
  const html = "<!doctype html><html><head><title>Page Title</title></head><body></body></html>";
  assert.equal(cleanTitle("", html), "Page Title");
});

test("cleanTitle: falls back to 'Untitled HTML' when no title provided and no <title> tag", () => {
  const html = "<!doctype html><html><body><p>no title</p></body></html>";
  assert.equal(cleanTitle("", html), "Untitled HTML");
});

test("cleanTitle: null value falls back to <title> extraction", () => {
  const html = "<!doctype html><html><head><title>From Tag</title></head><body></body></html>";
  assert.equal(cleanTitle(null, html), "From Tag");
});

test("cleanTitle: truncates provided title at 120 characters", () => {
  const longTitle = "A".repeat(200);
  const html = "<!doctype html><html><body></body></html>";
  const result = cleanTitle(longTitle, html);
  assert.equal(result.length, 120);
  assert.equal(result, "A".repeat(120));
});

test("cleanTitle: truncates <title> content at 120 characters", () => {
  const longTitle = "B".repeat(200);
  const html = `<!doctype html><html><head><title>${longTitle}</title></head><body></body></html>`;
  const result = cleanTitle("", html);
  assert.equal(result.length, 120);
  assert.equal(result, "B".repeat(120));
});

test("cleanTitle: collapses internal whitespace in title", () => {
  const html = "<!doctype html><html><body></body></html>";
  assert.equal(cleanTitle("  hello   world  ", html), "hello world");
});

// ---------------------------------------------------------------------------
// sanitizeShortText
// ---------------------------------------------------------------------------

test("sanitizeShortText: collapses whitespace and trims", () => {
  assert.equal(sanitizeShortText("  hello   world  ", 100), "hello world");
});

test("sanitizeShortText: truncates at maxLength", () => {
  assert.equal(sanitizeShortText("abcde", 3), "abc");
});

test("sanitizeShortText: returns empty string for non-string input (number)", () => {
  assert.equal(sanitizeShortText(42, 100), "");
});

test("sanitizeShortText: returns empty string for null", () => {
  assert.equal(sanitizeShortText(null, 100), "");
});

test("sanitizeShortText: returns empty string for undefined", () => {
  assert.equal(sanitizeShortText(undefined, 100), "");
});

test("sanitizeShortText: returns empty string for empty string input", () => {
  assert.equal(sanitizeShortText("", 100), "");
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

test("formatBytes: < 1024 → bytes", () => {
  assert.equal(formatBytes(500), "500 bytes");
});

test("formatBytes: exactly 1024 → KB", () => {
  assert.equal(formatBytes(1024), "1 KB");
});

test("formatBytes: exactly 1 MB (1024*1024) → MB", () => {
  assert.equal(formatBytes(1024 * 1024), "1 MB");
});

test("formatBytes: 0 → 0 bytes", () => {
  assert.equal(formatBytes(0), "0 bytes");
});

test("formatBytes: 1536 (1.5 KB) → rounds to 2 KB", () => {
  // Math.round(1536/1024) = Math.round(1.5) = 2
  assert.equal(formatBytes(1536), "2 KB");
});

test("formatBytes: 5 MB → 5 MB", () => {
  assert.equal(formatBytes(5 * 1024 * 1024), "5 MB");
});

// ---------------------------------------------------------------------------
// base64Url
// ---------------------------------------------------------------------------

test("base64Url: output contains no '+' characters", () => {
  // Test with many different byte values to exercise the full character set.
  for (let i = 0; i < 256; i++) {
    const bytes = new Uint8Array([i]);
    assert.equal(base64Url(bytes).includes("+"), false, `byte ${i} produced '+'`);
  }
});

test("base64Url: output contains no '/' characters", () => {
  for (let i = 0; i < 256; i++) {
    const bytes = new Uint8Array([i]);
    assert.equal(base64Url(bytes).includes("/"), false, `byte ${i} produced '/'`);
  }
});

test("base64Url: output contains no '=' padding characters", () => {
  for (let i = 0; i < 256; i++) {
    const bytes = new Uint8Array([i]);
    assert.equal(base64Url(bytes).includes("="), false, `byte ${i} produced '='`);
  }
});

test("base64Url: known input produces correct base64url output", () => {
  // [0xfb, 0xff, 0xfe] → standard base64 "+//+" → base64url "-__-"
  const bytes = new Uint8Array([0xfb, 0xff, 0xfe]);
  assert.equal(base64Url(bytes), "-__-");
});

test("base64Url: empty array produces empty string", () => {
  assert.equal(base64Url(new Uint8Array(0)), "");
});

// ---------------------------------------------------------------------------
// numberEnv
// ---------------------------------------------------------------------------

test("numberEnv: undefined returns fallback", () => {
  assert.equal(numberEnv(undefined, 42), 42);
});

test("numberEnv: empty string returns fallback", () => {
  assert.equal(numberEnv("", 42), 42);
});

test("numberEnv: valid number string returns parsed number", () => {
  assert.equal(numberEnv("100", 0), 100);
});

test("numberEnv: non-numeric string returns fallback", () => {
  assert.equal(numberEnv("not-a-number", 99), 99);
});

test("numberEnv: NaN string returns fallback", () => {
  assert.equal(numberEnv("NaN", 5), 5);
});

test("numberEnv: float string returns parsed float", () => {
  assert.equal(numberEnv("3.14", 0), 3.14);
});

// ---------------------------------------------------------------------------
// getClientIp
// ---------------------------------------------------------------------------

test("getClientIp: reads cf-connecting-ip header", () => {
  const req = new Request("https://example.com/", {
    headers: { "cf-connecting-ip": "1.2.3.4" }
  });
  assert.equal(getClientIp(req), "1.2.3.4");
});

test("getClientIp: falls back to first entry of x-forwarded-for when cf-connecting-ip absent", () => {
  const req = new Request("https://example.com/", {
    headers: { "x-forwarded-for": "9.8.7.6, 1.1.1.1" }
  });
  assert.equal(getClientIp(req), "9.8.7.6");
});

test("getClientIp: x-forwarded-for single value (no comma) returns trimmed value", () => {
  const req = new Request("https://example.com/", {
    headers: { "x-forwarded-for": "  5.5.5.5  " }
  });
  assert.equal(getClientIp(req), "5.5.5.5");
});

test("getClientIp: returns 'unknown' when neither header is present", () => {
  const req = new Request("https://example.com/");
  assert.equal(getClientIp(req), "unknown");
});

test("getClientIp: cf-connecting-ip takes precedence over x-forwarded-for", () => {
  const req = new Request("https://example.com/", {
    headers: {
      "cf-connecting-ip": "10.0.0.1",
      "x-forwarded-for": "9.9.9.9"
    }
  });
  assert.equal(getClientIp(req), "10.0.0.1");
});

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------

test("sha256Hex: returns a 64-character string", async () => {
  const result = await sha256Hex("hello");
  assert.equal(result.length, 64);
});

test("sha256Hex: output is lowercase hex", async () => {
  const result = await sha256Hex("hello");
  assert.match(result, /^[0-9a-f]{64}$/);
});

test("sha256Hex: deterministic — same input yields same output", async () => {
  const a = await sha256Hex("test-value");
  const b = await sha256Hex("test-value");
  assert.equal(a, b);
});

test("sha256Hex: different inputs yield different outputs", async () => {
  const a = await sha256Hex("foo");
  const b = await sha256Hex("bar");
  assert.notEqual(a, b);
});

test("sha256Hex: known SHA-256 of empty string", async () => {
  // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  const result = await sha256Hex("");
  assert.equal(result, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

// ---------------------------------------------------------------------------
// hashText
// ---------------------------------------------------------------------------

test("hashText: returns a 64-character hex string", async () => {
  const result = await hashText("value", "salt");
  assert.equal(result.length, 64);
  assert.match(result, /^[0-9a-f]{64}$/);
});

test("hashText: deterministic — same value and salt yield same output", async () => {
  const a = await hashText("myvalue", "mysalt");
  const b = await hashText("myvalue", "mysalt");
  assert.equal(a, b);
});

test("hashText: different salt → different output (same value)", async () => {
  const a = await hashText("myvalue", "salt1");
  const b = await hashText("myvalue", "salt2");
  assert.notEqual(a, b);
});

test("hashText: different value → different output (same salt)", async () => {
  const a = await hashText("value1", "salt");
  const b = await hashText("value2", "salt");
  assert.notEqual(a, b);
});

test("hashText: is equivalent to sha256Hex of salt:value", async () => {
  const expected = await sha256Hex("mysalt:myvalue");
  const actual = await hashText("myvalue", "mysalt");
  assert.equal(actual, expected);
});

// ---------------------------------------------------------------------------
// errorMessage
// ---------------------------------------------------------------------------

test("errorMessage: returns message property for Error instances", () => {
  const err = new Error("something went wrong");
  assert.equal(errorMessage(err), "something went wrong");
});

test("errorMessage: returns String() form for a plain string", () => {
  assert.equal(errorMessage("oops"), "oops");
});

test("errorMessage: returns String() form for a number", () => {
  assert.equal(errorMessage(42), "42");
});

test("errorMessage: returns String() form for null", () => {
  assert.equal(errorMessage(null), "null");
});

test("errorMessage: returns String() form for undefined", () => {
  assert.equal(errorMessage(undefined), "undefined");
});

test("errorMessage: returns String() form for an object", () => {
  assert.equal(errorMessage({ code: 500 }), "[object Object]");
});

test("errorMessage: Error subclass — returns its message", () => {
  const err = new TypeError("bad type");
  assert.equal(errorMessage(err), "bad type");
});

// ---------------------------------------------------------------------------
// logBackgroundError
// ---------------------------------------------------------------------------

test("logBackgroundError: does not throw for an Error", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    assert.doesNotThrow(() => logBackgroundError(new Error("bg fail")));
  } finally {
    spy.mockRestore();
  }
});

test("logBackgroundError: does not throw for a non-Error value", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    assert.doesNotThrow(() => logBackgroundError("plain string error"));
  } finally {
    spy.mockRestore();
  }
});

test("logBackgroundError: calls console.error once", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    logBackgroundError(new Error("test"));
    assert.equal(spy.mock.calls.length, 1);
  } finally {
    spy.mockRestore();
  }
});

test("logBackgroundError: returns undefined (void)", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = logBackgroundError(new Error("test"));
    assert.equal(result, undefined);
  } finally {
    spy.mockRestore();
  }
});
