import assert from "node:assert/strict";
import { test } from "vitest";

import {
  a2aAgentCard,
  authMarkdown,
  oauthAuthorizationServer,
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

test("a2aAgentCard: declares a non-empty supportedInterfaces with url + transport", () => {
  const card = a2aAgentCard() as Record<string, any>;
  assert.ok(Array.isArray(card.supportedInterfaces) && card.supportedInterfaces.length > 0,
    "expected non-empty supportedInterfaces array");
  const iface = card.supportedInterfaces[0];
  assert.ok(iface.url && iface.transport, "each interface needs url and transport");
  assert.ok(card.protocolVersion, "expected protocolVersion");
  assert.ok(card.preferredTransport, "expected preferredTransport");
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

test("authMarkdown: H1 heading contains 'auth.md' (scanner requirement)", () => {
  const firstLine = authMarkdown().split("\n")[0];
  assert.ok(firstLine.startsWith("# "), `expected an H1 heading, got: ${firstLine}`);
  assert.ok(firstLine.includes("auth.md"), `expected H1 to contain 'auth.md', got: ${firstLine}`);
});

// ---------------------------------------------------------------------------
// oauthAuthorizationServer
// ---------------------------------------------------------------------------

test("oauthAuthorizationServer: includes an agent_auth block with required fields", () => {
  const meta = oauthAuthorizationServer() as Record<string, any>;
  assert.ok(meta.agent_auth, "expected agent_auth block");
  assert.ok(meta.agent_auth.skill.endsWith("/auth.md"), "agent_auth.skill should point to /auth.md");
  assert.ok(meta.agent_auth.register_uri.includes("/api/shares"), "agent_auth.register_uri should be the upload endpoint");
  assert.deepEqual(meta.agent_auth.identity_types_supported, ["anonymous"]);
  assert.ok(
    meta.agent_auth.identity_assertion.anonymous.claim_uri.includes("/claim"),
    "anonymous flow should advertise a claim_uri"
  );
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
