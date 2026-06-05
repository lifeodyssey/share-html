import assert from "node:assert/strict";
import { test } from "vitest";

import {
  base64Url,
  cleanTitle,
  formatBytes,
  looksLikeHtml,
  numberEnv,
  sanitizeShortText,
} from "../src/worker/index.ts";

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
