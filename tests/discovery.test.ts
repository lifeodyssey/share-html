import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { LLMS_TXT, MCP_ENDPOINT, SHARE_HTML_SKILL, SITE_ORIGIN } from "../src/worker/constants.ts";
import {
  a2aAgentCard,
  authMarkdown,
  mcpServerCard,
  oauthAuthorizationServer,
  openApiDocument,
  mcpRegistryManifest,
  robotsTxt,
  sitemapXml,
  webMcpManifest,
} from "../src/worker/discovery.ts";
import { INDEXABLE_PATHS } from "../src/shared/marketing.ts";

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

test("robotsTxt: explicitly allows OpenAI search and user-request crawlers while GPTBot stays blocked", () => {
  const txt = robotsTxt();
  assert.match(txt, /User-agent: OAI-SearchBot\nAllow: \//);
  assert.match(txt, /User-agent: ChatGPT-User\nAllow: \//);
  assert.match(txt, /User-agent: GPTBot\nDisallow: \//);
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

test("robotsTxt: allows search, opts out of training, and does not grant AI input globally", () => {
  const txt = robotsTxt();
  assert.ok(
    txt.includes("Content-Signal: search=yes, ai-train=no, use=reference"),
    "expected an explicit, purpose-specific Content Signals policy"
  );
  assert.ok(!txt.includes("ai-input=yes"), "same-origin user content must not receive a global AI-input grant");
});

// ---------------------------------------------------------------------------
// openApiDocument
// ---------------------------------------------------------------------------

test("openApiDocument: publishes the exact supported path set", () => {
  const doc = openApiDocument();
  assert.deepEqual(Object.keys(doc.paths).sort(), [
    "/api/public/shares/{slug}",
    "/api/shares",
    "/api/shares/{id}",
    "/api/shares/{id}/access-key",
    "/api/shares/{id}/claim",
    "/api/shares/{id}/report",
    "/api/shares/{slug}/access",
    "/v/{slug}/",
  ]);
});

test("openApiDocument: contains /api/shares path", () => {
  const doc = openApiDocument();
  assert.ok("/api/shares" in doc.paths, "expected /api/shares path");
});

test("openApiDocument: contains /api/public/shares/{slug} path", () => {
  const doc = openApiDocument();
  assert.ok("/api/public/shares/{slug}" in doc.paths, "expected /api/public/shares/{slug} path");
});

test("openApiDocument: contains private-link access path", () => {
  const doc = openApiDocument();
  assert.ok("/api/shares/{slug}/access" in doc.paths, "expected private-link access path");
});

test("openApiDocument: contains /v/{slug}/ path", () => {
  const doc = openApiDocument();
  assert.ok("/v/{slug}/" in doc.paths, "expected /v/{slug}/ path");
});

test("openApiDocument: openapi version is 3.1.0", () => {
  const doc = openApiDocument();
  assert.equal(doc.openapi, "3.1.0");
});

test("openApiDocument: every operation has a unique operationId", () => {
  const doc = openApiDocument() as Record<string, any>;
  const operationIds = Object.values(doc.paths).flatMap((path: any) =>
    Object.values(path).map((operation: any) => operation.operationId)
  );
  assert.ok(operationIds.every((operationId) => typeof operationId === "string" && operationId.length > 0));
  assert.equal(new Set(operationIds).size, operationIds.length);
});

test("openApiDocument: create accepts both visibility modes and defaults to public_unlisted", () => {
  const doc = openApiDocument() as Record<string, any>;
  const schema = doc.paths["/api/shares"].post.requestBody.content["multipart/form-data"].schema;
  assert.ok(schema.required.includes("file"));
  assert.deepEqual(schema.properties.visibility.enum, ["public_unlisted", "private_link"]);
  assert.equal(schema.properties.visibility.default, "public_unlisted");
  assert.equal(schema.properties.source.pattern, "^[a-z0-9_-]{1,64}$");
});

test("openApiDocument: create response always includes accessKey with the exact private-key format", () => {
  const doc = openApiDocument() as Record<string, any>;
  const response = doc.components.schemas.CreateShareResponse;
  assert.deepEqual(response.required, ["share", "claimToken", "accessKey", "message"]);
  assert.deepEqual(response.properties.accessKey.type, ["string", "null"]);
  assert.equal(response.properties.accessKey.pattern, "^[A-Za-z0-9_-]{43}$");
  assert.equal(
    doc.paths["/api/shares"].post.responses["201"].content["application/json"].schema.$ref,
    "#/components/schemas/CreateShareResponse"
  );
});

test("openApiDocument: private public-metadata denial pins the 401 error contract", () => {
  const doc = openApiDocument() as Record<string, any>;
  const response = doc.paths["/api/public/shares/{slug}"].get.responses["401"];
  assert.deepEqual(response.content["application/json"].example, {
    error: "Access key required.",
    code: "share_access_required",
  });
});

test("openApiDocument: unlock supports a key or owner bearer and documents its conditional cookie", () => {
  const doc = openApiDocument() as Record<string, any>;
  const operation = doc.paths["/api/shares/{slug}/access"].post;
  const requestSchema = operation.requestBody.content["application/json"].schema;
  assert.equal(operation.requestBody.required, false);
  assert.equal(requestSchema.required, undefined);
  assert.equal(requestSchema.properties.accessKey.$ref, "#/components/schemas/AccessKey");
  assert.deepEqual(operation.security, [{}, { bearerAuth: [] }]);

  const cookie = operation.responses["200"].headers["Set-Cookie"];
  assert.match(cookie.description, /only when private_link/i);
  assert.match(cookie.description, /short-lived/i);
  assert.match(cookie.description, /HttpOnly/);
  assert.match(cookie.description, /scoped/i);
  assert.match(cookie.description, /preview path/i);
  assert.match(cookie.description, /metadata-unlock path/i);
  assert.deepEqual(operation.responses["401"].content["application/json"].example, {
    error: "Access key required.",
    code: "share_access_required",
  });
  assert.deepEqual(operation.responses["403"].content["application/json"].example, {
    error: "Invalid access key.",
    code: "invalid_share_access_key",
  });
});

test("openApiDocument: documents key rotation, claim, and delete owner operations", () => {
  const doc = openApiDocument() as Record<string, any>;
  const rotate = doc.paths["/api/shares/{id}/access-key"].post;
  assert.equal(rotate.operationId, "rotateShareAccessKey");
  assert.deepEqual(rotate.security, [{ bearerAuth: [] }]);
  assert.equal(
    rotate.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/RotateAccessKeyResponse"
  );
  assert.equal(doc.paths["/api/shares/{id}/claim"].post.operationId, "claimShare");
  assert.equal(doc.paths["/api/shares/{id}"].delete.operationId, "deleteShare");
  assert.ok(!("/api/auth/supabase/send-email" in doc.paths));
});

// ---------------------------------------------------------------------------
// a2aAgentCard
// ---------------------------------------------------------------------------

test("a2aAgentCard: advertises only the implemented describe skill", () => {
  const card = a2aAgentCard();
  assert.deepEqual(card.skills.map((skill) => skill.id), ["describe_share_html"]);
});

test("a2aAgentCard: has name 'Share HTML'", () => {
  const card = a2aAgentCard();
  assert.equal(card.name, "Share HTML");
});

test("a2aAgentCard: declares a real A2A 1.0 JSON-RPC interface without legacy fields", () => {
  const card = a2aAgentCard() as Record<string, any>;
  assert.ok(Array.isArray(card.supportedInterfaces) && card.supportedInterfaces.length > 0,
    "expected non-empty supportedInterfaces array");
  const iface = card.supportedInterfaces[0];
  assert.deepEqual(iface, {
    url: `${SITE_ORIGIN}/a2a`,
    protocolBinding: "JSONRPC",
    protocolVersion: "1.0",
  });
  assert.ok(!("protocolVersion" in card));
  assert.ok(!("preferredTransport" in card));
  assert.ok(!("url" in card));
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
// GEO / agent discovery contracts
// ---------------------------------------------------------------------------

test("llms.txt: distinguishes link access from ownership and pins private errors", () => {
  assert.ok(LLMS_TXT.includes("`public_unlisted`"));
  assert.ok(LLMS_TXT.includes("`private_link`"));
  assert.ok(LLMS_TXT.includes("`claimToken`"));
  assert.ok(LLMS_TXT.includes("`accessKey`"));
  assert.ok(LLMS_TXT.includes("share_access_required"));
  assert.ok(LLMS_TXT.includes("invalid_share_access_key"));
  assert.ok(LLMS_TXT.includes("#key="));
  assert.ok(LLMS_TXT.includes("ai-train=no"));
  assert.ok(LLMS_TXT.includes("noindex"));
  assert.ok(LLMS_TXT.includes("metadata"));
  assert.ok(LLMS_TXT.includes("exact unlock endpoint"));
  assert.ok(LLMS_TXT.includes(MCP_ENDPOINT));
});

test("agent skill: documents the private unlock route and secret URL fragment", () => {
  assert.ok(SHARE_HTML_SKILL.includes(`POST ${SITE_ORIGIN}/api/shares/{slug}/access`));
  assert.ok(SHARE_HTML_SKILL.includes("#key="));
  assert.ok(SHARE_HTML_SKILL.includes("path-scoped HttpOnly"));
});

test("WebMCP: exposes visibility on create and a private-link access tool", () => {
  const manifest = webMcpManifest();
  const create = manifest.tools.find((tool) => tool.name === "create_share");
  const access = manifest.tools.find((tool) => tool.name === "access_private_share");
  assert.ok(create?.input?.includes("visibility=public_unlisted|private_link"));
  assert.equal(access?.method, "POST");
  assert.equal(access?.url, `${SITE_ORIGIN}/api/shares/{slug}/access`);
  assert.ok(access?.input?.includes("accessKey"));
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

test("sitemapXml: lists the exact first-party acquisition pages and never a share URL", () => {
  const xml = sitemapXml();
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(locations, INDEXABLE_PATHS.map((path) => `${SITE_ORIGIN}${path}`));
  assert.ok(!xml.includes("/s/"));
  assert.ok(!xml.includes("/v/"));
  assert.ok(!xml.includes("{slug}"));
});

test("mcpRegistryManifest: matches the publishable remote-only server.json", () => {
  const manifest = mcpRegistryManifest();
  const file = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest, file);
  assert.deepEqual(manifest.remotes, [{
    type: "streamable-http",
    url: MCP_ENDPOINT,
  }]);
  assert.ok(!("packages" in manifest));
});

test("mcpServerCard: advertises the bot-policy-independent machine endpoint", () => {
  assert.equal(mcpServerCard().url, MCP_ENDPOINT);
});

// ---------------------------------------------------------------------------
// Homepage SEO and static fallback
// ---------------------------------------------------------------------------

test("index.html: homepage SEO is server-replaceable and complete without JavaScript", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.includes("<!-- share-html:seo:start -->"));
  assert.ok(html.includes("<!-- share-html:seo:end -->"));
  assert.ok(html.includes(`<link rel="canonical" href="${SITE_ORIGIN}/" />`));
  assert.ok(html.includes("<title>Share HTML — Upload and Share Sandboxed HTML Previews</title>"));
  assert.ok(html.includes('property="og:image" content="https://sharehtml.zhenjia.dev/og.png"'));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  assert.ok(html.includes('"@type": "WebSite"'));
  assert.ok(html.includes('"@type": "WebApplication"'));
  assert.ok(html.includes("Public unlisted"));
  assert.ok(html.includes("Private link"));
  assert.ok(html.includes("Share URLs are never added to the sitemap"));
});

test("og.png: has the declared 1200x630 dimensions", () => {
  const png = readFileSync(new URL("../public/og.png", import.meta.url));
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
