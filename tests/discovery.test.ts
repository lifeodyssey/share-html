import assert from "node:assert/strict";
import test from "node:test";

import {
  a2aAgentCard,
  authMarkdown,
  openApiDocument,
  robotsTxt,
  sitemapXml,
} from "../src/worker/discovery.ts";

// ---------------------------------------------------------------------------
// robotsTxt
// ---------------------------------------------------------------------------

test("robotsTxt: contains GPTBot user-agent entry", () => {
  const txt = robotsTxt();
  assert.ok(txt.includes("User-agent: GPTBot"), "expected GPTBot entry");
});

test("robotsTxt: contains ClaudeBot user-agent entry", () => {
  const txt = robotsTxt();
  assert.ok(txt.includes("User-agent: ClaudeBot"), "expected ClaudeBot entry");
});

test("robotsTxt: contains Sitemap: line pointing to sitemap.xml", () => {
  const txt = robotsTxt();
  assert.ok(txt.includes("Sitemap:"), "expected Sitemap: directive");
  assert.ok(txt.includes("sitemap.xml"), "expected sitemap.xml in Sitemap line");
});

test("robotsTxt: AI bots are disallowed (GPTBot)", () => {
  const txt = robotsTxt();
  // GPTBot block: "User-agent: GPTBot\nDisallow: /"
  const gptBotIndex = txt.indexOf("User-agent: GPTBot");
  const disallowAfter = txt.indexOf("Disallow: /", gptBotIndex);
  assert.ok(disallowAfter > gptBotIndex, "expected Disallow: / after GPTBot entry");
});

test("robotsTxt: AI bots are disallowed (ClaudeBot)", () => {
  const txt = robotsTxt();
  const claudeBotIndex = txt.indexOf("User-agent: ClaudeBot");
  const disallowAfter = txt.indexOf("Disallow: /", claudeBotIndex);
  assert.ok(disallowAfter > claudeBotIndex, "expected Disallow: / after ClaudeBot entry");
});

// ---------------------------------------------------------------------------
// openApiDocument
// ---------------------------------------------------------------------------

test("openApiDocument: has exactly 5 paths", () => {
  const doc = openApiDocument();
  const pathCount = Object.keys(doc.paths).length;
  assert.equal(pathCount, 5);
});

test("openApiDocument: contains /api/shares path", () => {
  const doc = openApiDocument();
  assert.ok("/api/shares" in doc.paths, "expected /api/shares path");
});

test("openApiDocument: contains /api/public/shares/{slug} path", () => {
  const doc = openApiDocument();
  assert.ok("/api/public/shares/{slug}" in doc.paths, "expected /api/public/shares/{slug} path");
});

test("openApiDocument: contains /v/{slug}/ path", () => {
  const doc = openApiDocument();
  assert.ok("/v/{slug}/" in doc.paths, "expected /v/{slug}/ path");
});

test("openApiDocument: openapi version is 3.1.0", () => {
  const doc = openApiDocument();
  assert.equal(doc.openapi, "3.1.0");
});

// ---------------------------------------------------------------------------
// a2aAgentCard
// ---------------------------------------------------------------------------

test("a2aAgentCard: skills array includes create_share skill", () => {
  const card = a2aAgentCard();
  const createShareSkill = card.skills.find((s: { id: string }) => s.id === "create_share");
  assert.ok(createShareSkill, "expected create_share skill in skills array");
});

test("a2aAgentCard: skills array includes get_public_share skill", () => {
  const card = a2aAgentCard();
  const skill = card.skills.find((s: { id: string }) => s.id === "get_public_share");
  assert.ok(skill, "expected get_public_share skill in skills array");
});

test("a2aAgentCard: has name 'Share HTML'", () => {
  const card = a2aAgentCard();
  assert.equal(card.name, "Share HTML");
});

// ---------------------------------------------------------------------------
// authMarkdown
// ---------------------------------------------------------------------------

test("authMarkdown: mentions POST /api/shares", () => {
  const md = authMarkdown();
  assert.ok(md.includes("POST /api/shares"), "expected POST /api/shares in authMarkdown");
});

test("authMarkdown: mentions GET /api/shares", () => {
  const md = authMarkdown();
  assert.ok(md.includes("GET /api/shares"), "expected GET /api/shares in authMarkdown");
});

test("authMarkdown: mentions DELETE /api/shares/{id}", () => {
  const md = authMarkdown();
  assert.ok(md.includes("DELETE /api/shares/{id}"), "expected DELETE /api/shares/{id} in authMarkdown");
});

// ---------------------------------------------------------------------------
// sitemapXml
// ---------------------------------------------------------------------------

test("sitemapXml: returns string starting with <?xml", () => {
  const xml = sitemapXml();
  assert.ok(xml.startsWith("<?xml"), `expected <?xml prefix, got: ${xml.slice(0, 20)}`);
});

test("sitemapXml: contains urlset element", () => {
  const xml = sitemapXml();
  assert.ok(xml.includes("<urlset"), "expected <urlset in sitemapXml output");
});

test("sitemapXml: contains a <loc> element", () => {
  const xml = sitemapXml();
  assert.ok(xml.includes("<loc>"), "expected <loc> in sitemapXml output");
});
