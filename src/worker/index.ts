import type { ShareRecord } from "../shared/types.ts";
import {
  createSecretToken,
  createUniqueSlug,
  getShareBySlug,
  logShareEvent,
  requireWorkerDatabaseAccess,
  restInsert,
  restRequest,
  restSelect,
  restUpdate,
  toPublicShare,
  randomSlug,
} from "./db.ts";
import { scanHtml } from "./scan.ts";
import {
  buildAuthEmailPlan,
  parseSupabaseSendEmailPayload,
  verifyStandardWebhookSignature
} from "./auth-email.ts";
import { LLMS_TXT, SHARE_HTML_SKILL, SITE_ORIGIN } from "./constants.ts";
import {
  acceptsMarkdown,
  corsHeaders,
  json,
  jsonResponse,
  methodNotAllowed,
  readJson,
  textResponse,
  withDiscoveryHeaders,
} from "./http.ts";
import {
  a2aAgentCard,
  agentSkillsIndex,
  apiCatalog,
  authMarkdown,
  mcpServerCard,
  oauthAuthorizationServer,
  oauthProtectedResource,
  openApiDocument,
  robotsTxt,
  securityTxt,
  sitemapXml,
  webMcpManifest
} from "./discovery.ts";

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

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8"
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const discoveryResponse = discoveryRoute(request, url);

    if (discoveryResponse) {
      return withDiscoveryHeaders(discoveryResponse);
    }

    if (url.pathname === "/mcp") {
      return await handleMcpRequest(request, env, ctx);
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

  if (url.pathname === "/.well-known/auth.md" || url.pathname === "/auth.md") {
    return textResponse(authMarkdown(), "text/markdown; charset=utf-8", request.method);
  }

  if (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/.well-known/agent.json") {
    return jsonResponse(a2aAgentCard(), "application/json; charset=utf-8", request.method);
  }

  if (url.pathname.startsWith("/.well-known/")) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  return null;
}


async function handleMcpRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
    const responses = (await Promise.all(payload.map((message) => handleMcpMessage(message, request, env, ctx)))).filter(Boolean);
    return mcpJson(responses);
  }

  return mcpJson(await handleMcpMessage(payload, request, env, ctx));
}

async function handleMcpMessage(message: unknown, request: Request, env: Env, ctx: ExecutionContext): Promise<Record<string, unknown> | null> {
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
        return await handleMcpToolCall(message.id, message.params, request, env, ctx);
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
    ,{
      name: "create_share",
      description: "Publish/host/share a single HTML page. Uploads an HTML document and returns a public sandboxed shareable URL. Use when the user wants to share, host, or get a link for an HTML file or page.",
      inputSchema: {
        type: "object",
        properties: {
          html: { type: "string", description: "The full HTML document to publish." },
          title: { type: "string", description: "Optional title for the share." }
        },
        required: ["html"],
        additionalProperties: false
      }
    }
  ];
}

async function handleMcpToolCall(
  id: unknown,
  params: unknown,
  request: Request,
  env: Env,
  ctx: ExecutionContext
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

  if (call?.name === "create_share") {
    const html = typeof call.arguments?.html === "string" ? call.arguments.html : "";
    if (!html) {
      return mcpResult(id, { isError: true, content: [{ type: "text", text: "Missing required 'html'." }] });
    }
    const title = typeof call.arguments?.title === "string" ? call.arguments.title : "";
    const result = await createShareRecord(env, ctx, request, { html, title, user: null });
    return mcpResult(id, {
      isError: result.status >= 400,
      content: [{ type: "text", text: JSON.stringify(result.body, null, 2) }]
    });
  }

  return mcpResult(id, { isError: true, content: [{ type: "text", text: "Unknown tool." }] });
}

function mcpJson(body: unknown): Response {
  return withDiscoveryHeaders(new Response(JSON.stringify(body, null, 2), { headers: JSON_HEADERS }));
}

async function createShare(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  requireWorkerDatabaseAccess(env);

  const user = await getOptionalUser(request, env);
  if (user?.banned_at) {
    return json({ error: "This account is not allowed to upload." }, 403);
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!isUploadFile(file)) {
    return json({ error: "Upload a single HTML file." }, 422);
  }

  const filename = file.name.toLowerCase();
  if (filename && !filename.endsWith(".html") && !filename.endsWith(".htm")) {
    return json({ error: "Only .html files are supported in this version." }, 422);
  }

  const html = await file.text();
  const title = typeof form.get("title") === "string" ? (form.get("title") as string) : "";

  const result = await createShareRecord(env, ctx, request, { html, title, user });
  return json(result.body, result.status);
}

async function createShareRecord(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  opts: { html: string; title: string; user: AuthUser | null }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { html, title, user } = opts;

  const ipHash = await hashText(getClientIp(request), env.IP_HASH_SALT ?? env.WORKER_API_SECRET);
  const uaHash = await hashText(request.headers.get("user-agent") ?? "unknown", env.IP_HASH_SALT ?? env.WORKER_API_SECRET);

  const rateLimit = await checkUploadRate(env, user, ipHash);
  if (!rateLimit.allowed) {
    return { status: 429, body: { error: rateLimit.reason } };
  }

  const byteLength = new TextEncoder().encode(html).length;
  const maxBytes = user ? numberEnv(env.MAX_USER_HTML_BYTES, 5 * 1024 * 1024) : numberEnv(env.MAX_ANON_HTML_BYTES, 1024 * 1024);
  if (byteLength <= 0 || byteLength > maxBytes) {
    return { status: 413, body: { error: `HTML must be between 1 byte and ${formatBytes(maxBytes)}.` } };
  }

  if (!looksLikeHtml(html)) {
    return { status: 422, body: { error: "The content does not look like an HTML document." } };
  }

  const shareId = crypto.randomUUID();
  const slug = await createUniqueSlug(env);
  const claimToken = user ? null : createSecretToken();
  const claimTokenHash = claimToken ? await hashText(claimToken, env.WORKER_API_SECRET) : null;
  const contentHash = await sha256Hex(html);
  const scan = scanHtml(html);
  const now = new Date();
  const expiresAt = user ? null : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const cleanedTitle = cleanTitle(title, html);
  const r2Prefix = `shares/${shareId}/`;
  const r2Key = `${r2Prefix}index.html`;

  await restInsert<ShareRecord>(env, "shares", {
    id: shareId,
    slug,
    owner_user_id: user?.id ?? null,
    title: cleanedTitle,
    entry_path: "index.html",
    r2_prefix: r2Prefix,
    size_bytes: byteLength,
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
      size_bytes: byteLength,
      content_hash: contentHash
    });

    const [share] = await restUpdate<ShareRecord>(env, "shares", `id=eq.${shareId}`, {
      lifecycle_status: scan.lifecycle,
      moderation_status: scan.status
    });

    ctx.waitUntil(logShareEvent(env, shareId, user?.id ?? null, "created", ipHash, uaHash, { risk_score: scan.score }).catch(logBackgroundError));

    return {
      status: scan.lifecycle === "blocked" ? 202 : 201,
      body: {
        share: toPublicShare(share, request, env),
        claimToken,
        message: scan.lifecycle === "blocked" ? "Uploaded, but blocked by automatic risk checks." : "Uploaded."
      }
    };
  } catch (error) {
    await restUpdate(env, "shares", `id=eq.${shareId}`, {
      lifecycle_status: "failed",
      moderation_status: "pending"
    });
    console.error(JSON.stringify({ event: "upload_failed", share_id: shareId, message: errorMessage(error) }));
    return { status: 500, body: { error: "Upload failed after metadata was created." } };
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

export { randomSlug, createSecretToken, createUniqueSlug, getShareBySlug, logShareEvent, restSelect, restInsert, restUpdate, restRequest, toPublicShare, requireWorkerDatabaseAccess };

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

export function cleanTitle(value: FormDataEntryValue | null, html: string): string {
  const explicit = sanitizeShortText(typeof value === "string" ? value : "", 120);
  if (explicit) return explicit;
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return sanitizeShortText(match?.[1] ?? "Untitled HTML", 120) || "Untitled HTML";
}

export function sanitizeShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function looksLikeHtml(html: string): boolean {
  const sample = html.slice(0, 2048).toLowerCase();
  return sample.includes("<!doctype html") || sample.includes("<html") || /<body[\s>]/i.test(sample) || /<script[\s>]/i.test(sample);
}

export function isUploadFile(value: FormDataEntryValue | null): value is File {
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

export { base64Url } from "./db.ts";

export function numberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} bytes`;
}

export function escapeHtml(value: string): string {
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
