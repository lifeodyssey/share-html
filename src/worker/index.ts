import type { PublicShare, RiskReason, ShareRecord } from "../shared/types";
import {
  buildAuthEmailPlan,
  parseSupabaseSendEmailPayload,
  verifyStandardWebhookSignature
} from "./auth-email";

type Env = {
  ASSETS: Fetcher;
  AUTH_EMAIL?: SendEmail;
  SHARE_HTML_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_REST_KEY: string;
  WORKER_API_SECRET: string;
  SUPABASE_SEND_EMAIL_HOOK_SECRET?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_FROM_NAME?: string;
  APP_ORIGIN?: string;
  PREVIEW_ORIGIN?: string;
  IP_HASH_SALT?: string;
  MAX_ANON_HTML_BYTES?: string;
  MAX_USER_HTML_BYTES?: string;
};

type AuthUser = {
  id: string;
  email?: string;
  role: "user" | "admin";
  banned_at: string | null;
};

type ScanResult = {
  score: number;
  status: "clean" | "suspicious" | "blocked";
  lifecycle: "active" | "needs_review" | "blocked";
  reasons: RiskReason[];
  urls: string[];
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8"
};

const SITE_ORIGIN = "https://sharehtml.zhenjia.dev";
const SUPABASE_AUTH_ISSUER = "https://hihvtuyweqxnsmqmegdt.supabase.co/auth/v1";
const DISCOVERY_LINKS = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/openapi+json"',
  '</llms.txt>; rel="service-doc"; type="text/markdown"',
  '</.well-known/openid-configuration>; rel="openid-configuration"; type="application/json"',
  '</.well-known/oauth-authorization-server>; rel="oauth-authorization-server"; type="application/json"',
  '</.well-known/oauth-protected-resource>; rel="oauth-protected-resource"; type="application/json"',
  '</.well-known/mcp/server-card.json>; rel="service-desc"; type="application/json"',
  '</.well-known/agent-skills/index.json>; rel="service-doc"; type="application/json"',
  '</.well-known/webmcp.json>; rel="service-desc"; type="application/json"'
].join(", ");

const LLMS_TXT = `# Share HTML

Share HTML is a Cloudflare-hosted tool for uploading one self-contained HTML file and sharing it as a sandboxed live preview.

## Site Identity

- Canonical origin: ${SITE_ORIGIN}
- GitHub repository: https://github.com/lifeodyssey/share-html
- Primary use case: quick HTML prototypes, mockups, receipts, demos, and one-off pages that need a URL.

## Important Routes

- App home: ${SITE_ORIGIN}/
- Create share API: POST ${SITE_ORIGIN}/api/shares
- Supabase auth email hook: POST ${SITE_ORIGIN}/api/auth/supabase/send-email
- List signed-in user's shares: GET ${SITE_ORIGIN}/api/shares
- Public share API: GET ${SITE_ORIGIN}/api/public/shares/{slug}
- Public share page: ${SITE_ORIGIN}/s/{slug}
- Sandboxed preview: ${SITE_ORIGIN}/v/{slug}/
- API catalog: ${SITE_ORIGIN}/.well-known/api-catalog
- OpenAPI description: ${SITE_ORIGIN}/openapi.json

## Safety Model

- Uploaded HTML is not sanitized. It is isolated in a sandboxed preview route.
- Anonymous uploads expire after 365 days.
- Signed-in users can keep and delete shares.
- A lightweight scanner can mark uploads clean, suspicious, needs review, or blocked.
- Private R2 objects are only read by this Worker.

## Agent Use

- Use the share page at /s/{slug} when you want safety context and metadata.
- Use the preview route at /v/{slug}/ only when you intentionally need the uploaded HTML itself.
- Do not treat uploaded pages as authored by Zhenjia unless the share metadata or surrounding context says so.
`;

const SHARE_HTML_SKILL = `---
name: share-html
description: Use this skill when uploading, inspecting, or citing Share HTML links from sharehtml.zhenjia.dev.
---

# Share HTML

Share HTML publishes one uploaded HTML document as a sandboxed preview.

## Routes

- Home: ${SITE_ORIGIN}/
- Share page: ${SITE_ORIGIN}/s/{slug}
- Direct preview: ${SITE_ORIGIN}/v/{slug}/
- Create share: POST ${SITE_ORIGIN}/api/shares
- Public share metadata: GET ${SITE_ORIGIN}/api/public/shares/{slug}

## Rules

- Prefer the /s/{slug} share page when citing or sharing a link.
- Use /v/{slug}/ only for direct visual inspection of the uploaded HTML.
- Uploaded HTML is user-supplied content. Do not infer that it is first-party documentation.
- Respect blocked, expired, or needs-review statuses.
`;

const SLUG_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SHORT_LINK_HOSTS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "buff.ly"];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const discoveryResponse = discoveryRoute(request, url);

    if (discoveryResponse) {
      return withDiscoveryHeaders(discoveryResponse);
    }

    if (url.pathname === "/mcp") {
      return await handleMcpRequest(request, env);
    }

    if (url.pathname === "/" && acceptsMarkdown(request)) {
      return withDiscoveryHeaders(textResponse(LLMS_TXT, "text/markdown; charset=utf-8", request.method));
    }

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      if (url.pathname === "/api/config" && request.method === "GET") {
        return json({
          supabaseUrl: env.SUPABASE_URL,
          supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY
        });
      }

      if (url.pathname === "/api/auth/supabase/send-email") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        return await sendSupabaseAuthEmail(request, env);
      }

      if (url.pathname === "/api/shares" && request.method === "POST") {
        return await createShare(request, env, ctx);
      }

      if (url.pathname === "/api/shares" && request.method === "GET") {
        return await listMyShares(request, env);
      }

      const publicShareMatch = url.pathname.match(/^\/api\/public\/shares\/([^/]+)$/);
      if (publicShareMatch && request.method === "GET") {
        return await getPublicShare(publicShareMatch[1], request, env);
      }

      const reportMatch = url.pathname.match(/^\/api\/shares\/([0-9a-f-]+)\/report$/);
      if (reportMatch && request.method === "POST") {
        return await reportShare(reportMatch[1], request, env, ctx);
      }

      const claimMatch = url.pathname.match(/^\/api\/shares\/([0-9a-f-]+)\/claim$/);
      if (claimMatch && request.method === "POST") {
        return await claimShare(claimMatch[1], request, env, ctx);
      }

      const deleteMatch = url.pathname.match(/^\/api\/shares\/([0-9a-f-]+)$/);
      if (deleteMatch && request.method === "DELETE") {
        return await deleteShare(deleteMatch[1], request, env, ctx);
      }

      const adminReportsMatch = url.pathname === "/api/admin/reports";
      if (adminReportsMatch && request.method === "GET") {
        return await listReports(request, env);
      }

      const adminBlockMatch = url.pathname.match(/^\/api\/admin\/shares\/([0-9a-f-]+)\/(block|unblock)$/);
      if (adminBlockMatch && request.method === "POST") {
        return await moderateShare(adminBlockMatch[1], adminBlockMatch[2] as "block" | "unblock", request, env, ctx);
      }

      if (url.pathname.startsWith("/v/") && request.method === "GET") {
        return await previewShare(request, env, ctx);
      }

      return withDiscoveryHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      console.error(JSON.stringify({ event: "unhandled_error", message: errorMessage(error) }));
      return json({ error: "Internal server error" }, 500);
    }
  }
};

function discoveryRoute(request: Request, url: URL): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  if (url.pathname === "/llms.txt") {
    return textResponse(LLMS_TXT, "text/markdown; charset=utf-8", request.method);
  }

  if (url.pathname === "/robots.txt") {
    return textResponse(robotsTxt(), "text/plain; charset=utf-8", request.method);
  }

  if (url.pathname === "/sitemap.xml") {
    return textResponse(sitemapXml(), "application/xml; charset=utf-8", request.method);
  }

  if (url.pathname === "/openapi.json") {
    return jsonResponse(openApiDocument(), "application/openapi+json; charset=utf-8", request.method);
  }

  if (url.pathname === "/.well-known/api-catalog") {
    return jsonResponse(apiCatalog(), "application/linkset+json; charset=utf-8", request.method);
  }

  if (url.pathname === "/.well-known/oauth-protected-resource") {
    return jsonResponse(oauthProtectedResource(), "application/json; charset=utf-8", request.method);
  }

  if (url.pathname === "/.well-known/openid-configuration" || url.pathname === "/.well-known/oauth-authorization-server") {
    return jsonResponse(oauthAuthorizationServer(), "application/json; charset=utf-8", request.method);
  }

  if (url.pathname === "/.well-known/mcp/server-card.json") {
    return jsonResponse(mcpServerCard(), "application/json; charset=utf-8", request.method);
  }

  if (url.pathname === "/.well-known/webmcp.json") {
    return jsonResponse(webMcpManifest(), "application/json; charset=utf-8", request.method);
  }

  if (url.pathname === "/.well-known/agent-skills/index.json") {
    return jsonResponse(agentSkillsIndex(), "application/json; charset=utf-8", request.method);
  }

  if (url.pathname === "/.well-known/agent-skills/share-html/SKILL.md") {
    return textResponse(SHARE_HTML_SKILL, "text/markdown; charset=utf-8", request.method);
  }

  if (url.pathname === "/.well-known/security.txt") {
    return textResponse(securityTxt(), "text/plain; charset=utf-8", request.method);
  }

  return null;
}

function acceptsMarkdown(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return (request.headers.get("accept") || "").toLowerCase().includes("text/markdown");
}

function withDiscoveryHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const currentLink = headers.get("Link");
  headers.set("Link", currentLink ? `${currentLink}, ${DISCOVERY_LINKS}` : DISCOVERY_LINKS);
  headers.set("X-Content-Type-Options", headers.get("X-Content-Type-Options") ?? "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function textResponse(body: string, contentType: string, method: string): Response {
  return new Response(method === "HEAD" ? null : body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=3600"
    }
  });
}

function jsonResponse(body: unknown, contentType: string, method: string): Response {
  return new Response(method === "HEAD" ? null : JSON.stringify(body, null, 2), {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=3600"
    }
  });
}

function robotsTxt(): string {
  return [
    "User-agent: *",
    "Content-Signal: search=yes,ai-input=yes,ai-train=no",
    "Allow: /",
    "",
    "User-agent: Amazonbot",
    "Disallow: /",
    "",
    "User-agent: Applebot-Extended",
    "Disallow: /",
    "",
    "User-agent: Bytespider",
    "Disallow: /",
    "",
    "User-agent: CCBot",
    "Disallow: /",
    "",
    "User-agent: ClaudeBot",
    "Disallow: /",
    "",
    "User-agent: Google-Extended",
    "Disallow: /",
    "",
    "User-agent: GPTBot",
    "Disallow: /",
    "",
    "User-agent: meta-externalagent",
    "Disallow: /",
    "",
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    ""
  ].join("\n");
}

function sitemapXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_ORIGIN}/</loc>
  </url>
</urlset>
`;
}

function apiCatalog() {
  return {
    linkset: [
      {
        anchor: `${SITE_ORIGIN}/.well-known/api-catalog`,
        "service-desc": [
          {
            href: `${SITE_ORIGIN}/openapi.json`,
            type: "application/openapi+json",
            title: "Share HTML OpenAPI description"
          },
          {
            href: `${SITE_ORIGIN}/.well-known/webmcp.json`,
            type: "application/json",
            title: "Share HTML WebMCP manifest"
          }
        ],
        "service-doc": [
          {
            href: `${SITE_ORIGIN}/llms.txt`,
            type: "text/markdown",
            title: "AI-readable site guide"
          },
          {
            href: "https://github.com/lifeodyssey/share-html#readme",
            type: "text/html",
            title: "Human-readable project documentation"
          }
        ],
        item: [
          { href: `${SITE_ORIGIN}/api/shares`, title: "Create or list shares" },
          { href: `${SITE_ORIGIN}/api/auth/supabase/send-email`, title: "Handle Supabase auth email delivery" },
          { href: `${SITE_ORIGIN}/api/public/shares/{slug}`, title: "Read public share metadata" },
          { href: `${SITE_ORIGIN}/api/shares/{id}/report`, title: "Report a share" },
          { href: `${SITE_ORIGIN}/v/{slug}/`, title: "Render sandboxed uploaded HTML" }
        ],
        "oauth-protected-resource": [
          {
            href: `${SITE_ORIGIN}/.well-known/oauth-protected-resource`,
            type: "application/json",
            title: "OAuth protected resource metadata"
          }
        ]
      }
    ]
  };
}

function oauthProtectedResource() {
  return {
    resource: SITE_ORIGIN,
    authorization_servers: [SUPABASE_AUTH_ISSUER],
    scopes_supported: ["openid", "email"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${SITE_ORIGIN}/llms.txt`
  };
}

function oauthAuthorizationServer() {
  return {
    issuer: SUPABASE_AUTH_ISSUER,
    authorization_endpoint: `${SUPABASE_AUTH_ISSUER}/oauth/authorize`,
    token_endpoint: `${SUPABASE_AUTH_ISSUER}/oauth/token`,
    jwks_uri: `${SUPABASE_AUTH_ISSUER}/.well-known/jwks.json`,
    userinfo_endpoint: `${SUPABASE_AUTH_ISSUER}/oauth/userinfo`,
    scopes_supported: ["openid", "profile", "email", "phone"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256", "HS256", "ES256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    claims_supported: [
      "sub",
      "aud",
      "iss",
      "exp",
      "iat",
      "auth_time",
      "nonce",
      "email",
      "email_verified",
      "phone_number",
      "phone_number_verified",
      "name",
      "picture",
      "preferred_username",
      "updated_at"
    ],
    code_challenge_methods_supported: ["S256", "plain"]
  };
}

function mcpServerCard() {
  return {
    serverInfo: {
      name: "Share HTML",
      version: "0.1.0"
    },
    description: "Read Share HTML site context and public share metadata through MCP.",
    url: `${SITE_ORIGIN}/mcp`,
    transport: {
      type: "streamable-http"
    },
    capabilities: {
      tools: true
    }
  };
}

function agentSkillsIndex() {
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: "share-html",
        type: "skill-md",
        description: "Use this skill when uploading, inspecting, or citing Share HTML links from sharehtml.zhenjia.dev.",
        url: "/.well-known/agent-skills/share-html/SKILL.md"
      }
    ]
  };
}

async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET" || request.method === "HEAD") {
    return withDiscoveryHeaders(jsonResponse(mcpServerCard(), "application/json; charset=utf-8", request.method));
  }

  if (request.method !== "POST") {
    return withDiscoveryHeaders(new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } }));
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return mcpJson({ id: null, error: { code: -32700, message: "Parse error" } });
  }

  if (Array.isArray(payload)) {
    const responses = (await Promise.all(payload.map((message) => handleMcpMessage(message, request, env)))).filter(Boolean);
    return mcpJson(responses);
  }

  return mcpJson(await handleMcpMessage(payload, request, env));
}

async function handleMcpMessage(message: unknown, request: Request, env: Env): Promise<Record<string, unknown> | null> {
  if (!isJsonRpcRequest(message)) {
    return { id: null, error: { code: -32600, message: "Invalid Request" } };
  }

  if (!("id" in message)) return null;

  try {
    switch (message.method) {
      case "initialize":
        return mcpResult(message.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "Share HTML", version: "0.1.0" }
        });
      case "tools/list":
        return mcpResult(message.id, { tools: mcpTools() });
      case "tools/call":
        return await handleMcpToolCall(message.id, message.params, request, env);
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } };
    }
  } catch (error) {
    return { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: errorMessage(error) } };
  }
}

function isJsonRpcRequest(value: unknown): value is { id?: unknown; method: string; params?: unknown } {
  return typeof value === "object" && value !== null && typeof (value as { method?: unknown }).method === "string";
}

function mcpResult(id: unknown, result: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function mcpTools() {
  return [
    {
      name: "describe_share_html",
      description: "Return the AI-readable Share HTML guide, including routes and safety model.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
      name: "get_public_share",
      description: "Fetch public metadata for a Share HTML slug.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Public Share HTML slug" }
        },
        required: ["slug"],
        additionalProperties: false
      }
    }
  ];
}

async function handleMcpToolCall(
  id: unknown,
  params: unknown,
  request: Request,
  env: Env
): Promise<Record<string, unknown>> {
  const call = params as { name?: string; arguments?: Record<string, unknown> } | null;

  if (call?.name === "describe_share_html") {
    return mcpResult(id, { content: [{ type: "text", text: LLMS_TXT }] });
  }

  if (call?.name === "get_public_share") {
    const slug = typeof call.arguments?.slug === "string" ? call.arguments.slug : "";
    if (!slug) {
      return mcpResult(id, { isError: true, content: [{ type: "text", text: "Missing required slug." }] });
    }

    const share = await getShareBySlug(env, slug);
    if (!share || share.deleted_at) {
      return mcpResult(id, { isError: true, content: [{ type: "text", text: "Share not found." }] });
    }

    return mcpResult(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(toPublicShare(share, request, env), null, 2)
        }
      ]
    });
  }

  return mcpResult(id, { isError: true, content: [{ type: "text", text: "Unknown tool." }] });
}

function mcpJson(body: unknown): Response {
  return withDiscoveryHeaders(new Response(JSON.stringify(body, null, 2), { headers: JSON_HEADERS }));
}

function webMcpManifest() {
  return {
    name: "Share HTML",
    origin: SITE_ORIGIN,
    description: "Upload one HTML file and share it as a sandboxed live preview.",
    tools: [
      {
        name: "create_share",
        description: "Create a public share from one .html or .htm file.",
        method: "POST",
        url: `${SITE_ORIGIN}/api/shares`,
        input: "multipart/form-data with file and optional title"
      },
      {
        name: "get_public_share",
        description: "Fetch public metadata for a share slug.",
        method: "GET",
        url: `${SITE_ORIGIN}/api/public/shares/{slug}`
      },
      {
        name: "report_share",
        description: "Report suspicious or unwanted shared HTML.",
        method: "POST",
        url: `${SITE_ORIGIN}/api/shares/{id}/report`
      }
    ]
  };
}

function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Share HTML API",
      version: "0.1.0",
      description: "API for uploading one HTML file, listing owned shares, reading public share metadata, reporting shares, and previewing sandboxed HTML."
    },
    servers: [{ url: SITE_ORIGIN }],
    paths: {
      "/api/shares": {
        post: {
          summary: "Create a share",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary" },
                    title: { type: "string", maxLength: 120 }
                  }
                }
              }
            }
          },
          responses: {
            "201": { description: "Share created" },
            "202": { description: "Share uploaded but blocked by risk checks" },
            "422": { description: "Invalid upload" }
          }
        },
        get: {
          summary: "List signed-in user's shares",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Shares returned" },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/public/shares/{slug}": {
        get: {
          summary: "Get public share metadata",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Public share metadata" },
            "404": { description: "Share not found" }
          }
        }
      },
      "/api/auth/supabase/send-email": {
        post: {
          summary: "Handle Supabase Send Email Auth Hook",
          description: "Internal endpoint called by Supabase Auth. Verifies Standard Webhooks headers, renders Share HTML auth email, and sends it through Cloudflare Email Service.",
          responses: {
            "200": { description: "Email accepted by Cloudflare Email Service" },
            "401": { description: "Invalid hook signature" },
            "500": { description: "Email binding or hook secret is not configured" }
          }
        }
      },
      "/api/shares/{id}/report": {
        post: {
          summary: "Report a share",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": { description: "Report accepted" }
          }
        }
      },
      "/v/{slug}/": {
        get: {
          summary: "Render uploaded HTML in the preview route",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Sandboxed HTML preview" },
            "403": { description: "Blocked by moderation" },
            "410": { description: "Share expired" }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      }
    }
  };
}

function securityTxt(): string {
  return [
    "Contact: mailto:zhenjiazhou0127@outlook.com",
    "Preferred-Languages: en, zh, ja",
    `Canonical: ${SITE_ORIGIN}/.well-known/security.txt`,
    ""
  ].join("\n");
}

async function createShare(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  requireWorkerDatabaseAccess(env);

  const user = await getOptionalUser(request, env);
  if (user?.banned_at) {
    return json({ error: "This account is not allowed to upload." }, 403);
  }

  const ipHash = await hashText(getClientIp(request), env.IP_HASH_SALT ?? env.WORKER_API_SECRET);
  const uaHash = await hashText(request.headers.get("user-agent") ?? "unknown", env.IP_HASH_SALT ?? env.WORKER_API_SECRET);
  const rateLimit = await checkUploadRate(env, user, ipHash);
  if (!rateLimit.allowed) {
    return json({ error: rateLimit.reason }, 429);
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!isUploadFile(file)) {
    return json({ error: "Upload a single HTML file." }, 422);
  }

  const maxBytes = user ? numberEnv(env.MAX_USER_HTML_BYTES, 5 * 1024 * 1024) : numberEnv(env.MAX_ANON_HTML_BYTES, 1024 * 1024);
  if (file.size <= 0 || file.size > maxBytes) {
    return json({ error: `HTML must be between 1 byte and ${formatBytes(maxBytes)}.` }, 413);
  }

  const filename = file.name.toLowerCase();
  if (filename && !filename.endsWith(".html") && !filename.endsWith(".htm")) {
    return json({ error: "Only .html files are supported in this version." }, 422);
  }

  const html = await file.text();
  if (!looksLikeHtml(html)) {
    return json({ error: "The file does not look like an HTML document." }, 422);
  }

  const shareId = crypto.randomUUID();
  const slug = await createUniqueSlug(env);
  const claimToken = user ? null : createSecretToken();
  const claimTokenHash = claimToken ? await hashText(claimToken, env.WORKER_API_SECRET) : null;
  const contentHash = await sha256Hex(html);
  const scan = scanHtml(html);
  const now = new Date();
  const expiresAt = user ? null : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const title = cleanTitle(form.get("title"), html);
  const r2Prefix = `shares/${shareId}/`;
  const r2Key = `${r2Prefix}index.html`;

  await restInsert<ShareRecord>(env, "shares", {
    id: shareId,
    slug,
    owner_user_id: user?.id ?? null,
    title,
    entry_path: "index.html",
    r2_prefix: r2Prefix,
    size_bytes: file.size,
    content_hash: contentHash,
    lifecycle_status: "uploading",
    moderation_status: "pending",
    risk_score: scan.score,
    risk_reasons: scan.reasons,
    claim_token_hash: claimTokenHash,
    creator_ip_hash: ipHash,
    creator_user_agent_hash: uaHash,
    expires_at: expiresAt
  });

  try {
    await env.SHARE_HTML_BUCKET.put(r2Key, html, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { share_id: shareId, content_hash: contentHash }
    });

    await restInsert(env, "share_assets", {
      share_id: shareId,
      path: "index.html",
      r2_key: r2Key,
      content_type: "text/html; charset=utf-8",
      size_bytes: file.size,
      content_hash: contentHash
    });

    const [share] = await restUpdate<ShareRecord>(env, "shares", `id=eq.${shareId}`, {
      lifecycle_status: scan.lifecycle,
      moderation_status: scan.status
    });

    ctx.waitUntil(logShareEvent(env, shareId, user?.id ?? null, "created", ipHash, uaHash, { risk_score: scan.score }).catch(logBackgroundError));

    return json({
      share: toPublicShare(share, request, env),
      claimToken,
      message: scan.lifecycle === "blocked" ? "Uploaded, but blocked by automatic risk checks." : "Uploaded."
    }, scan.lifecycle === "blocked" ? 202 : 201);
  } catch (error) {
    await restUpdate(env, "shares", `id=eq.${shareId}`, {
      lifecycle_status: "failed",
      moderation_status: "pending"
    });
    console.error(JSON.stringify({ event: "upload_failed", share_id: shareId, message: errorMessage(error) }));
    return json({ error: "Upload failed after metadata was created." }, 500);
  }
}

async function sendSupabaseAuthEmail(request: Request, env: Env): Promise<Response> {
  if (!env.AUTH_EMAIL) {
    return json({ error: "Cloudflare Email binding is not configured." }, 500);
  }
  if (!env.SUPABASE_SEND_EMAIL_HOOK_SECRET) {
    return json({ error: "Supabase send-email hook secret is not configured." }, 500);
  }

  const rawBody = await request.text();
  const verified = await verifyStandardWebhookSignature({
    rawBody,
    secret: env.SUPABASE_SEND_EMAIL_HOOK_SECRET,
    headers: request.headers
  });
  if (!verified) {
    return json({ error: "Invalid hook signature." }, 401);
  }

  const payload = (() => {
    try {
      return parseSupabaseSendEmailPayload(rawBody);
    } catch (error) {
      console.error(JSON.stringify({ event: "auth_email_payload_invalid", message: errorMessage(error) }));
      return null;
    }
  })();
  if (!payload) {
    return json({ error: "Invalid auth email payload." }, 400);
  }

  const messages = buildAuthEmailPlan(payload, {
    appOrigin: env.APP_ORIGIN ?? SITE_ORIGIN,
    fromAddress: env.AUTH_EMAIL_FROM ?? "sharehtml@zhenjia.dev",
    fromName: env.AUTH_EMAIL_FROM_NAME ?? "Share HTML",
    supabaseUrl: env.SUPABASE_URL
  });

  try {
    for (const plan of messages) {
      await env.AUTH_EMAIL.send({
        from: { email: plan.fromAddress, name: plan.fromName },
        to: plan.to,
        subject: plan.subject,
        text: plan.text,
        html: plan.html
      });
    }

    console.log(JSON.stringify({
      event: "auth_email_sent",
      action_type: payload.email_data.email_action_type,
      message_count: messages.length
    }));

    return json({});
  } catch (error) {
    console.error(JSON.stringify({ event: "auth_email_failed", message: errorMessage(error) }));
    return json({ error: "Auth email delivery failed." }, 502);
  }
}

async function listMyShares(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const shares = await restSelect<ShareRecord>(
    env,
    `shares?select=*&owner_user_id=eq.${user.id}&deleted_at=is.null&order=created_at.desc&limit=100`
  );

  return json({ shares: shares.map((share) => toPublicShare(share, request, env)) });
}

async function getPublicShare(slug: string, request: Request, env: Env): Promise<Response> {
  const share = await getShareBySlug(env, slug);
  if (!share || share.deleted_at) return json({ error: "Share not found" }, 404);

  return json({ share: toPublicShare(share, request, env) });
}

async function reportShare(shareId: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const user = await getOptionalUser(request, env);
  const body = await readJson<{ reason?: string; details?: string }>(request);
  const reason = sanitizeShortText(body.reason, 80) || "other";
  const details = sanitizeShortText(body.details, 1000);
  const ipHash = await hashText(getClientIp(request), env.IP_HASH_SALT ?? env.WORKER_API_SECRET);
  const uaHash = await hashText(request.headers.get("user-agent") ?? "unknown", env.IP_HASH_SALT ?? env.WORKER_API_SECRET);

  await restInsert(env, "reports", {
    share_id: shareId,
    reporter_user_id: user?.id ?? null,
    reason,
    details
  });

  ctx.waitUntil(logShareEvent(env, shareId, user?.id ?? null, "reported", ipHash, uaHash, { reason }).catch(logBackgroundError));
  return json({ ok: true });
}

async function claimShare(shareId: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const body = await readJson<{ claimToken?: string }>(request);
  if (!body.claimToken) return json({ error: "Missing claim token." }, 422);

  const claimTokenHash = await hashText(body.claimToken, env.WORKER_API_SECRET);
  const [share] = await restSelect<ShareRecord>(
    env,
    `shares?select=*&id=eq.${shareId}&claim_token_hash=eq.${encodeURIComponent(claimTokenHash)}&owner_user_id=is.null&limit=1`
  );
  if (!share) return json({ error: "Invalid claim token." }, 403);

  const [updated] = await restUpdate<ShareRecord>(env, "shares", `id=eq.${shareId}`, {
    owner_user_id: user.id,
    claim_token_hash: null,
    expires_at: null
  });

  ctx.waitUntil(logShareEvent(env, shareId, user.id, "claimed", null, null, {}).catch(logBackgroundError));
  return json({ share: toPublicShare(updated, request, env) });
}

async function deleteShare(shareId: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const filter = user.role === "admin" ? `id=eq.${shareId}` : `id=eq.${shareId}&owner_user_id=eq.${user.id}`;
  const [updated] = await restUpdate<ShareRecord>(env, "shares", filter, {
    lifecycle_status: "deleted",
    deleted_at: new Date().toISOString()
  });

  if (!updated) return json({ error: "Share not found." }, 404);
  ctx.waitUntil(logShareEvent(env, shareId, user.id, "deleted", null, null, {}).catch(logBackgroundError));
  return json({ ok: true });
}

async function listReports(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const reports = await restSelect(env, "reports?select=*&status=eq.open&order=created_at.desc&limit=100");
  return json({ reports });
}

async function moderateShare(shareId: string, action: "block" | "unblock", request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const patch = action === "block"
    ? { lifecycle_status: "blocked", moderation_status: "blocked" }
    : { lifecycle_status: "active", moderation_status: "clean", risk_score: 0, risk_reasons: [] };

  const [share] = await restUpdate<ShareRecord>(env, "shares", `id=eq.${shareId}`, patch);
  if (!share) return json({ error: "Share not found." }, 404);

  ctx.waitUntil(logShareEvent(env, shareId, admin.id, action === "block" ? "blocked" : "unblocked", null, null, {}).catch(logBackgroundError));
  return json({ share: toPublicShare(share, request, env) });
}

async function previewShare(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/v\/([^/]+)\/?(.*)$/);
  if (!match) return previewMessage("Not found", 404, request, env);

  const slug = match[1];
  const relativePath = match[2] || "";
  if (relativePath && relativePath !== "index.html") {
    return previewMessage("This share only contains index.html.", 404, request, env);
  }

  const share = await getShareBySlug(env, slug);
  if (!share || share.deleted_at) return previewMessage("Share not found.", 404, request, env);
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
    return previewMessage("This share has expired.", 410, request, env);
  }
  if (share.lifecycle_status === "blocked") {
    return previewMessage("This share was blocked by moderation.", 403, request, env);
  }
  if (share.lifecycle_status !== "active" && share.lifecycle_status !== "needs_review") {
    return previewMessage("This share is not ready yet.", 409, request, env);
  }

  const object = await env.SHARE_HTML_BUCKET.get(`${share.r2_prefix}${share.entry_path}`);
  if (!object?.body) return previewMessage("The uploaded HTML object is missing.", 404, request, env);

  ctx.waitUntil(logShareEvent(env, share.id, null, "viewed", null, null, {}).catch(logBackgroundError));

  return new Response(object.body, {
    headers: previewHeaders(request, env, {
      "content-type": object.httpMetadata?.contentType ?? "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      etag: share.content_hash
    })
  });
}

function scanHtml(html: string): ScanResult {
  const reasons: RiskReason[] = [];
  const urls = Array.from(html.matchAll(/https?:\/\/[^\s"'<>`)]+/gi)).map((match) => match[0]);
  const lower = html.toLowerCase();

  addReasonIf(reasons, /<form[^>]+action=["']https?:\/\//i.test(html) && /type=["']password["']/i.test(html), "external_password_form", 40, "Password form posts to an external origin.");
  addReasonIf(reasons, /\b(seed phrase|private key|recovery phrase|wallet connect|metamask|phantom wallet)\b/i.test(html), "wallet_keywords", 25, "Contains wallet or seed phrase language.");
  addReasonIf(reasons, /\b(window|parent|top)\.location\b|\blocation\.(href|replace|assign)\b/i.test(html), "top_navigation_attempt", 20, "Contains JavaScript navigation code.");
  addReasonIf(reasons, /<base[^>]+href=["']https?:\/\//i.test(html), "external_base_href", 20, "Contains an external base URL.");
  addReasonIf(reasons, /http:\/\//i.test(html), "mixed_content", 15, "References non-HTTPS resources.");
  addReasonIf(reasons, SHORT_LINK_HOSTS.some((host) => lower.includes(host)), "short_link_reference", 15, "References a common short-link host.");
  addReasonIf(reasons, /<iframe[^>]+src=["']https?:\/\//i.test(html) && /login|signin|wallet|verify/i.test(html), "suspicious_iframe", 20, "Embeds an external login-like frame.");

  const score = Math.min(100, reasons.reduce((sum, reason) => sum + reason.weight, 0));
  if (score >= 80) return { score, status: "blocked", lifecycle: "blocked", reasons, urls };
  if (score >= 50) return { score, status: "suspicious", lifecycle: "needs_review", reasons, urls };
  return { score, status: "clean", lifecycle: "active", reasons, urls };
}

function addReasonIf(reasons: RiskReason[], condition: boolean, code: string, weight: number, detail: string): void {
  if (condition) reasons.push({ code, weight, detail });
}

async function checkUploadRate(env: Env, user: AuthUser | null, ipHash: string): Promise<{ allowed: boolean; reason?: string }> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const filter = user
    ? `owner_user_id=eq.${user.id}&created_at=gte.${encodeURIComponent(since)}`
    : `creator_ip_hash=eq.${encodeURIComponent(ipHash)}&created_at=gte.${encodeURIComponent(since)}`;
  const limit = user ? 100 : 10;
  const rows = await restSelect<{ id: string }>(env, `shares?select=id&${filter}&limit=${limit + 1}`);
  if (rows.length > limit) {
    return { allowed: false, reason: user ? "User upload limit reached. Try again later." : "Anonymous upload limit reached. Try again later." };
  }
  return { allowed: true };
}

async function getOptionalUser(request: Request, env: Env): Promise<AuthUser | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return await getUserFromToken(header.slice("Bearer ".length), env);
  } catch {
    return null;
  }
}

async function requireUser(request: Request, env: Env): Promise<AuthUser | Response> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);
  try {
    return await getUserFromToken(header.slice("Bearer ".length), env);
  } catch {
    return json({ error: "Invalid session." }, 401);
  }
}

async function requireAdmin(request: Request, env: Env): Promise<AuthUser | Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  if (user.role !== "admin") return json({ error: "Admin access required." }, 403);
  return user;
}

async function getUserFromToken(token: string, env: Env): Promise<AuthUser> {
  requireWorkerDatabaseAccess(env);
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) throw new Error(`Supabase auth returned ${response.status}`);
  const raw = await response.json<{ id: string; email?: string }>();
  const [profile] = await restSelect<{ role: "user" | "admin"; banned_at: string | null }>(
    env,
    `profiles?select=role,banned_at&id=eq.${raw.id}&limit=1`
  );

  if (!profile) {
    await restInsert(env, "profiles", { id: raw.id, display_name: raw.email?.split("@")[0] ?? "User" });
  }

  return {
    id: raw.id,
    email: raw.email,
    role: profile?.role ?? "user",
    banned_at: profile?.banned_at ?? null
  };
}

async function createUniqueSlug(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const slug = randomSlug(10);
    const existing = await restSelect<{ id: string }>(env, `shares?select=id&slug=eq.${slug}&limit=1`);
    if (existing.length === 0) return slug;
  }
  return `${randomSlug(10)}${Date.now().toString(36)}`;
}

function randomSlug(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join("");
}

function createSecretToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function getShareBySlug(env: Env, slug: string): Promise<ShareRecord | null> {
  const [share] = await restSelect<ShareRecord>(env, `shares?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return share ?? null;
}

async function logShareEvent(
  env: Env,
  shareId: string,
  actorUserId: string | null,
  eventType: string,
  ipHash: string | null,
  userAgentHash: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  await restInsert(env, "share_events", {
    share_id: shareId,
    actor_user_id: actorUserId,
    event_type: eventType,
    ip_hash: ipHash,
    user_agent_hash: userAgentHash,
    metadata
  });
}

async function restSelect<T>(env: Env, path: string): Promise<T[]> {
  return restRequest<T[]>(env, path, { method: "GET" });
}

async function restInsert<T>(env: Env, table: string, row: Record<string, unknown>): Promise<T> {
  const rows = await restRequest<T[]>(env, `${table}?select=*`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(row)
  });
  return rows[0];
}

async function restUpdate<T>(env: Env, table: string, filter: string, patch: Record<string, unknown>): Promise<T[]> {
  return restRequest<T[]>(env, `${table}?${filter}&select=*`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(patch)
  });
}

async function restRequest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  requireWorkerDatabaseAccess(env);
  const headers = new Headers(init.headers);
  headers.set("apikey", env.SUPABASE_REST_KEY);
  headers.set("authorization", `Bearer ${env.SUPABASE_REST_KEY}`);
  headers.set("x-worker-secret", env.WORKER_API_SECRET);
  if (init.body) headers.set("content-type", "application/json");

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase REST ${response.status}: ${text}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json<T>();
}

function toPublicShare(share: ShareRecord, request: Request, env: Env): PublicShare {
  const requestOrigin = new URL(request.url).origin;
  const appOrigin = env.APP_ORIGIN || requestOrigin;
  const previewOrigin = env.PREVIEW_ORIGIN || requestOrigin;
  return {
    id: share.id,
    slug: share.slug,
    title: share.title,
    lifecycle_status: share.lifecycle_status,
    moderation_status: share.moderation_status,
    risk_score: share.risk_score,
    risk_reasons: share.risk_reasons,
    share_url: `${appOrigin}/s/${share.slug}`,
    preview_url: `${previewOrigin}/v/${share.slug}/`,
    expires_at: share.expires_at,
    created_at: share.created_at,
    size_bytes: share.size_bytes,
    owner_user_id: share.owner_user_id
  };
}

function previewHeaders(request: Request, env: Env, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  const appOrigin = env.APP_ORIGIN || new URL(request.url).origin;
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set(
    "content-security-policy",
    [
      "default-src 'self' https: data: blob:",
      "script-src 'unsafe-inline' 'unsafe-eval' https: blob:",
      "style-src 'unsafe-inline' https:",
      "img-src https: data: blob:",
      "connect-src https:",
      `frame-ancestors 'self' ${appOrigin}`,
      "base-uri 'none'"
    ].join("; ")
  );
  return headers;
}

function previewMessage(message: string, status: number, request: Request, env: Env): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>Share unavailable</title><body style="font-family: ui-sans-serif, system-ui; margin: 2rem; color: #26322f;"><h1>Share unavailable</h1><p>${escapeHtml(message)}</p></body>`;
  return new Response(html, {
    status,
    headers: previewHeaders(request, env, { ...HTML_HEADERS, "cache-control": "no-store" })
  });
}

function cleanTitle(value: FormDataEntryValue | null, html: string): string {
  const explicit = sanitizeShortText(typeof value === "string" ? value : "", 120);
  if (explicit) return explicit;
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return sanitizeShortText(match?.[1] ?? "Untitled HTML", 120) || "Untitled HTML";
}

function sanitizeShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function looksLikeHtml(html: string): boolean {
  const sample = html.slice(0, 2048).toLowerCase();
  return sample.includes("<!doctype html") || sample.includes("<html") || /<body[\s>]/i.test(sample) || /<script[\s>]/i.test(sample);
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "size" in value && "name" in value;
}

function getClientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashText(value: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${value}`);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json<T>();
  } catch {
    return {} as T;
  }
}

function json(body: unknown, status = 200): Response {
  return withDiscoveryHeaders(new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  }));
}

function methodNotAllowed(allow: string): Response {
  return withDiscoveryHeaders(new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: allow }
  }));
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers(JSON_HEADERS);
  headers.set("access-control-allow-origin", request.headers.get("origin") ?? "*");
  headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type");
  return headers;
}

function requireWorkerDatabaseAccess(env: Env): void {
  if (!env.SUPABASE_REST_KEY || !env.WORKER_API_SECRET) {
    throw new Error("SUPABASE_REST_KEY and WORKER_API_SECRET must be configured.");
  }
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} bytes`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      default: return "&#039;";
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logBackgroundError(error: unknown): void {
  console.error(JSON.stringify({ event: "background_error", message: errorMessage(error) }));
}
