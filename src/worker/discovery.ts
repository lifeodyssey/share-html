import { MCP_ENDPOINT, SITE_ORIGIN, SUPABASE_AUTH_ISSUER } from "./constants.ts";
import { INDEXABLE_PATHS } from "../shared/marketing.ts";

export function robotsTxt(): string {
  return [
    "User-agent: *",
    "Content-Signal: search=yes, ai-train=no, use=reference",
    "Allow: /",
    "",
    "User-agent: OAI-SearchBot",
    "Allow: /",
    "",
    "User-agent: ChatGPT-User",
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
  const urls = INDEXABLE_PATHS.map((path) => [
    "  <url>",
    `    <loc>${SITE_ORIGIN}${path}</loc>`,
    "  </url>",
  ].join("\n")).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
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
          },
          {
            href: `${SITE_ORIGIN}/.well-known/agent-card.json`,
            type: "application/json",
            title: "Share HTML A2A agent card"
          }
        ],
        "service-doc": [
          {
            href: `${SITE_ORIGIN}/llms.txt`,
            type: "text/markdown",
            title: "AI-readable site guide"
          },
          {
            href: `${SITE_ORIGIN}/agents`,
            type: "text/html",
            title: "Agent quickstart and live integration guide"
          },
          {
            href: "https://github.com/lifeodyssey/share-html#readme",
            type: "text/html",
            title: "Human-readable project documentation"
          }
        ],
        item: [
          { href: `${SITE_ORIGIN}/api/shares`, title: "Create or list shares" },
          { href: `${SITE_ORIGIN}/api/public/shares/{slug}`, title: "Read public-unlisted share metadata" },
          { href: `${SITE_ORIGIN}/api/shares/{slug}/access`, title: "Unlock private-link share metadata" },
          { href: `${SITE_ORIGIN}/api/shares/{id}/access-key`, title: "Rotate an owned private-link access key" },
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
    code_challenge_methods_supported: ["S256", "plain"],
    // auth.md agent-registration extension. Share HTML has no OAuth client
    // registration; an agent "registers" by creating an anonymous resource and
    // receives a claim token, which a signed-in account later claims.
    agent_auth: {
      skill: `${SITE_ORIGIN}/auth.md`,
      register_uri: `${SITE_ORIGIN}/api/shares`,
      identity_types_supported: ["anonymous"],
      identity_assertion: {
        anonymous: {
          credential_types_supported: ["claim_token"],
          claim_uri: `${SITE_ORIGIN}/api/shares/{id}/claim`
        }
      }
    }
  };
}

export function mcpServerCard() {
  return {
    serverInfo: {
      name: "Share HTML",
      version: "0.1.0"
    },
    description: "Create public-unlisted or access-key-protected private previews and read public share metadata through MCP. Private creation returns the access key once.",
    url: MCP_ENDPOINT,
    transport: {
      type: "streamable-http",
      protocolVersion: "2025-11-25"
    },
    capabilities: {
      tools: true
    }
  };
}

export function mcpRegistryManifest() {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: "dev.zhenjia/share-html",
    title: "Share HTML",
    description: "Create sandboxed public-unlisted or access-key-protected HTML previews through a remote MCP server.",
    version: "0.1.0",
    repository: {
      url: "https://github.com/lifeodyssey/share-html",
      source: "github",
    },
    websiteUrl: `${SITE_ORIGIN}/agents`,
    remotes: [
      {
        type: "streamable-http",
        url: MCP_ENDPOINT,
      },
    ],
  };
}

export function a2aAgentCard() {
  return {
    name: "Share HTML",
    description: "Describe Share HTML's public-unlisted and access-key-protected private sharing APIs through an A2A 1.0 JSON-RPC interface.",
    version: "1.0.0",
    provider: {
      organization: "Zhenjia",
      url: "https://zhenjia.dev",
    },
    documentationUrl: `${SITE_ORIGIN}/agents`,
    supportedInterfaces: [
      { url: `${SITE_ORIGIN}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }
    ],
    capabilities: { streaming: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "describe_share_html",
        name: "Describe Share HTML",
        description: "Return the canonical service guide, routes, access modes, and safety boundaries.",
        tags: ["html", "hosting", "share", "privacy", "documentation"],
        examples: ["How do I create a private Share HTML link?"]
      }
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
    description: "Upload one HTML file and share it as a public-unlisted or access-key-protected private sandboxed preview.",
    tools: [
      {
        name: "create_share",
        description: "Create a public_unlisted (default) or private_link share from one .html or .htm file. Private creation returns accessKey once.",
        method: "POST",
        url: `${SITE_ORIGIN}/api/shares`,
        input: "multipart/form-data with file, optional title, and optional visibility=public_unlisted|private_link"
      },
      {
        name: "get_public_share",
        description: "Fetch metadata for a public_unlisted slug. A private_link returns HTTP 401 share_access_required.",
        method: "GET",
        url: `${SITE_ORIGIN}/api/public/shares/{slug}`
      },
      {
        name: "access_private_share",
        description: "Unlock private_link metadata and set short-lived, path-scoped HttpOnly metadata and preview grants. Treat accessKey and the returned #key share URL as secrets.",
        method: "POST",
        url: `${SITE_ORIGIN}/api/shares/{slug}/access`,
        input: "application/json with required accessKey"
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
      description: "Upload one HTML file as public_unlisted or private_link, unlock private metadata with an access key, and render the content in a sandboxed preview. Share URLs are never published in the sitemap."
    },
    servers: [{ url: SITE_ORIGIN }],
    paths: {
      "/api/shares": {
        post: {
          operationId: "createShare",
          summary: "Create a share",
          description: "Creates public_unlisted by default. For private_link, the response returns a 32-byte base64url accessKey and share.share_url includes that key in a client-side #key= fragment. Treat both as secrets.",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary" },
                    title: { type: "string", description: "Optional display title." },
                    source: {
                      type: "string",
                      pattern: "^[a-z0-9_-]{1,64}$",
                      description: "Optional acquisition source used only in aggregate upload event metadata."
                    },
                    visibility: {
                      type: "string",
                      enum: ["public_unlisted", "private_link"],
                      default: "public_unlisted",
                      description: "Access mode for the new share."
                    }
                  }
                }
              }
            }
          },
          responses: {
            "201": {
              description: "Share created. accessKey is null for public_unlisted and a secret for private_link.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CreateShareResponse" } } }
            },
            "202": {
              description: "Share uploaded but blocked by risk checks. The response shape is unchanged.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CreateShareResponse" } } }
            },
            "413": { description: "HTML is empty or exceeds the upload limit" },
            "422": { description: "Invalid upload or visibility" },
            "429": { description: "Anonymous or user upload rate limit reached" }
          }
        },
        get: {
          operationId: "listShares",
          summary: "List signed-in user's shares",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Shares returned",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["shares"],
                    properties: {
                      shares: { type: "array", items: { $ref: "#/components/schemas/ShareMetadata" } }
                    }
                  }
                }
              }
            },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/public/shares/{slug}": {
        get: {
          operationId: "getPublicShare",
          summary: "Get public-unlisted share metadata",
          description: "Returns metadata only for public_unlisted. A private_link must be unlocked through POST /api/shares/{slug}/access.",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Public-unlisted share metadata",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ShareMetadataResponse" } } }
            },
            "401": {
              description: "The slug is private and requires an access key",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                  example: { error: "Access key required.", code: "share_access_required" }
                }
              }
            },
            "404": { description: "Share not found" }
          }
        }
      },
      "/api/shares/{slug}/access": {
        post: {
          operationId: "accessPrivateShare",
          summary: "Unlock private-link share metadata",
          description: "For private_link, validates accessKey, a still-valid metadata grant, or the owner's Bearer token; returns share metadata; and renews short-lived, host-only HttpOnly grants scoped separately to /v/{slug} and this exact unlock path. For public_unlisted, returns metadata without setting a cookie. Send keys only in the JSON body, never as a query parameter.",
          security: [{}, { bearerAuth: [] }],
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    accessKey: { $ref: "#/components/schemas/AccessKey" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Access granted and share metadata returned",
              headers: {
                "Set-Cookie": {
                  description: "Set only when private_link access succeeds. Contains separate short-lived HttpOnly authorization cookies scoped to this share's preview path and exact metadata-unlock path.",
                  schema: { type: "string" }
                }
              },
              content: { "application/json": { schema: { $ref: "#/components/schemas/ShareMetadataResponse" } } }
            },
            "403": {
              description: "The access key is invalid",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                  example: { error: "Invalid access key.", code: "invalid_share_access_key" }
                }
              }
            },
            "401": {
              description: "No access key, owner token, or still-valid metadata grant was supplied",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                  example: { error: "Access key required.", code: "share_access_required" }
                }
              }
            },
            "404": { description: "Share not found" }
          }
        }
      },
      "/api/shares/{id}/access-key": {
        post: {
          operationId: "rotateShareAccessKey",
          summary: "Rotate an owned private-link access key",
          description: "Replaces the key for an owned private_link share. Existing metadata and preview grants stop working immediately. The new secret is returned once and embedded in share.share_url as a #key= fragment.",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": {
              description: "Key rotated",
              content: { "application/json": { schema: { $ref: "#/components/schemas/RotateAccessKeyResponse" } } }
            },
            "401": { description: "Authentication required" },
            "404": { description: "Owned private share not found" }
          }
        }
      },
      "/api/shares/{id}/claim": {
        post: {
          operationId: "claimShare",
          summary: "Claim an anonymous share",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["claimToken"],
                  additionalProperties: false,
                  properties: { claimToken: { type: "string" } }
                }
              }
            }
          },
          responses: {
            "200": { description: "Share claimed", content: { "application/json": { schema: { $ref: "#/components/schemas/ShareMetadataResponse" } } } },
            "401": { description: "Authentication required" },
            "403": { description: "Invalid claim token" },
            "422": { description: "Missing claim token" }
          }
        }
      },
      "/api/shares/{id}": {
        delete: {
          operationId: "deleteShare",
          summary: "Soft-delete an owned share",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": { description: "Share deleted" },
            "401": { description: "Authentication required" },
            "404": { description: "Owned share not found" }
          }
        }
      },
      "/api/shares/{id}/report": {
        post: {
          operationId: "reportShare",
          summary: "Report a share",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": { description: "Report accepted" }
          }
        }
      },
      "/v/{slug}/": {
        get: {
          operationId: "previewShare",
          summary: "Render uploaded HTML in the preview route",
          description: "public_unlisted previews open directly. private_link previews require the short-lived cookie set by POST /api/shares/{slug}/access.",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Sandboxed HTML preview" },
            "403": { description: "Private preview access is required, the preview cookie expired, or the share was blocked by moderation" },
            "410": { description: "Share expired" }
          }
        }
      }
    },
    components: {
      schemas: {
        Visibility: {
          type: "string",
          enum: ["public_unlisted", "private_link"]
        },
        AccessKey: {
          type: "string",
          pattern: "^[A-Za-z0-9_-]{43}$",
          description: "A 32-byte, unpadded base64url secret returned when a private_link share is created."
        },
        ShareMetadata: {
          type: "object",
          required: [
            "id",
            "slug",
            "title",
            "visibility",
            "lifecycle_status",
            "moderation_status",
            "risk_score",
            "risk_reasons",
            "share_url",
            "preview_url",
            "expires_at",
            "created_at",
            "size_bytes"
          ],
          properties: {
            id: { type: "string", format: "uuid" },
            slug: { type: "string" },
            title: { type: ["string", "null"] },
            visibility: { $ref: "#/components/schemas/Visibility" },
            lifecycle_status: { type: "string", enum: ["uploading", "scanning", "active", "needs_review", "blocked", "deleted", "failed"] },
            moderation_status: { type: "string", enum: ["pending", "clean", "suspicious", "blocked"] },
            risk_score: { type: "integer", minimum: 0 },
            risk_reasons: { type: "array", items: { type: "object" } },
            share_url: {
              type: "string",
              format: "uri",
              description: "Wrapper-page URL. On private creation this includes the access key in a client-side #key= fragment."
            },
            preview_url: { type: "string", format: "uri" },
            expires_at: { type: ["string", "null"], format: "date-time" },
            created_at: { type: "string", format: "date-time" },
            size_bytes: { type: "integer", minimum: 0 }
          }
        },
        ShareMetadataResponse: {
          type: "object",
          required: ["share"],
          properties: {
            share: { $ref: "#/components/schemas/ShareMetadata" }
          }
        },
        CreateShareResponse: {
          type: "object",
          required: ["share", "claimToken", "accessKey", "message"],
          properties: {
            share: { $ref: "#/components/schemas/ShareMetadata" },
            claimToken: {
              type: ["string", "null"],
              description: "One-time ownership claim token for an anonymous upload; null for an authenticated upload. This does not grant private-link access."
            },
            accessKey: {
              type: ["string", "null"],
              pattern: "^[A-Za-z0-9_-]{43}$",
              description: "null for public_unlisted; a 32-byte base64url secret for private_link."
            },
            message: { type: "string" }
          }
        },
        RotateAccessKeyResponse: {
          type: "object",
          required: ["share", "accessKey"],
          properties: {
            share: { $ref: "#/components/schemas/ShareMetadata" },
            accessKey: { $ref: "#/components/schemas/AccessKey" }
          }
        },
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string" },
            code: { type: "string" }
          }
        }
      },
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
    "# auth.md — Share HTML",
    "",
    "Agent audience: automated agents and humans uploading a single HTML file for a",
    "sandboxed public-unlisted or private-link preview. No agent pre-registration is required; uploading",
    "anonymously provisions a resource and returns a claim token.",
    "",
    "## Anonymous (no auth)",
    "- `POST /api/shares` accepts uploads with no authentication (the registration endpoint).",
    "- The response returns a one-time `claimToken` so the upload can be claimed later.",
    "- `accessKey` is separate: it is null for public-unlisted shares and unlocks private-link shares.",
    "- Anonymous uploads are rate-limited and kept for 365 days.",
    "",
    "## Claim ceremony (anonymous to owned)",
    "- `POST /api/shares/{id}/claim` with the `claimToken` and a Bearer token transfers an",
    "  anonymous upload to a signed-in account.",
    "- A claim token transfers ownership; it never grants private-link viewing access.",
    "",
    "## Private-link access (no account required)",
    "- `POST /api/shares/{slug}/access` accepts JSON `{\"accessKey\":\"...\"}`.",
    "- Success returns metadata and sets separate short-lived, path-scoped HttpOnly grants for metadata recovery and preview access.",
    "- The private `share_url` contains the key in a client-side `#key=` fragment; treat the full URL as a secret.",
    "",
    "## Signed-in (Supabase)",
    "- Sign-in uses Supabase email OTP (magic link).",
    "- Authenticated API calls send `Authorization: Bearer <supabase_access_token>`.",
    "",
    "## Protected endpoints (require Bearer token)",
    "- `GET /api/shares` — list your shares",
    "- `DELETE /api/shares/{id}` — delete a share",
    "- `POST /api/shares/{id}/claim` — claim an anonymous upload",
    "- `POST /api/shares/{id}/access-key` — rotate an owned private-link key",
    "",
    "## Machine-readable metadata",
    `- OAuth Protected Resource: ${SITE_ORIGIN}/.well-known/oauth-protected-resource`,
    `- OAuth Authorization Server (includes \`agent_auth\`): ${SITE_ORIGIN}/.well-known/oauth-authorization-server`
  ].join("\n");
}
