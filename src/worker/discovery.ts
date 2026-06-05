import { SITE_ORIGIN, SUPABASE_AUTH_ISSUER } from "./constants";

export function robotsTxt(): string {
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

export function sitemapXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_ORIGIN}/</loc>
  </url>
</urlset>
`;
}

export function apiCatalog() {
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

export function oauthProtectedResource() {
  return {
    resource: SITE_ORIGIN,
    authorization_servers: [SUPABASE_AUTH_ISSUER],
    scopes_supported: ["openid", "email"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${SITE_ORIGIN}/llms.txt`
  };
}

export function oauthAuthorizationServer() {
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

export function mcpServerCard() {
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

export function a2aAgentCard() {
  return {
    name: "Share HTML",
    description: "Upload one HTML file and get a public sandboxed shareable preview link.",
    url: SITE_ORIGIN,
    version: "1.0.0",
    capabilities: { streaming: false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    skills: [
      { id: "create_share", name: "Create share", description: "Upload an HTML document and return a public shareable URL.", tags: ["html", "hosting", "share"] },
      { id: "get_public_share", name: "Get public share", description: "Fetch public metadata for a Share HTML slug.", tags: ["metadata"] }
    ]
  };
}

export function agentSkillsIndex() {
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

export function webMcpManifest() {
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

export function openApiDocument() {
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

export function securityTxt(): string {
  return [
    "Contact: mailto:zhenjiazhou0127@outlook.com",
    "Preferred-Languages: en, zh, ja",
    `Canonical: ${SITE_ORIGIN}/.well-known/security.txt`,
    ""
  ].join("\n");
}

export function authMarkdown(): string {
  return [
    "# Authentication — Share HTML",
    "",
    "## Anonymous (no auth)",
    "- `POST /api/shares` accepts uploads with no authentication.",
    "- Anonymous uploads are rate-limited and kept for 365 days.",
    "",
    "## Signed-in (Supabase)",
    "- Sign-in uses Supabase email OTP (magic link).",
    "- Authenticated API calls send `Authorization: Bearer <supabase_access_token>`.",
    "",
    "## Protected endpoints (require Bearer token)",
    "- `GET /api/shares` — list your shares",
    "- `DELETE /api/shares/{id}` — delete a share",
    "- `POST /api/shares/{id}/claim` — claim an anonymous upload",
    "",
    `Discovery: ${SITE_ORIGIN}/.well-known/oauth-protected-resource`
  ].join("\n");
}
