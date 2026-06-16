import {
  errorMessage,
} from "./utils.ts";
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
import {
  createShare,
  checkUploadRate,
  listMyShares,
  getPublicShare,
  reportShare,
  claimShare,
  deleteShare,
  listReports,
  moderateShare,
  previewShare,
  previewHeaders,
  previewMessage,
} from "./shares.ts";
import { handleMcpRequest } from "./mcp.ts";

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

      const assetResponse = await env.ASSETS.fetch(request);
      const contentType = assetResponse.headers.get("content-type") ?? "";
      if (contentType.includes("text/html") && request.method === "GET") {
        return withDiscoveryHeaders(await injectConfig(assetResponse, env));
      }
      return withDiscoveryHeaders(assetResponse);
    } catch (error) {
      console.error(JSON.stringify({ event: "unhandled_error", message: errorMessage(error) }));
      return json({ error: "Internal server error" }, 500);
    }
  }
};

/**
 * Injects the Supabase client config into an HTML response so the browser
 * can initialise the Supabase client without a separate /api/config fetch.
 * The injected script sets window.__APP_CONFIG__ before any module scripts run.
 */
async function injectConfig(response: Response, env: Env): Promise<Response> {
  const configScript = `<script>window.__APP_CONFIG__=${JSON.stringify({
    supabaseUrl: env.SUPABASE_URL,
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY
  })}</script>`;
  const html = await response.text();
  const injected = html.replace("</head>", `${configScript}</head>`);
  return new Response(injected, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

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

export { randomSlug, createSecretToken, createUniqueSlug, getShareBySlug, logShareEvent, toPublicShare, requireWorkerDatabaseAccess } from "./db.ts";
export { countRecentUploadsByIp, countRecentUploadsByUser, insertShare, insertShareAsset, updateShareScanResult, findUserShares, insertReport, getOpenReports, findClaimableShare, claimShareRow, softDeleteShare, setShareModeration, getUserProfile, insertUserProfile } from "./db.ts";
export { getUserFromToken, getOptionalUser, requireUser, requireAdmin } from "./auth.ts";
export type { AuthUser } from "./auth.ts";
export { cleanTitle, sanitizeShortText, looksLikeHtml, isUploadFile, getClientIp, sha256Hex, hashText, base64Url, numberEnv, formatBytes, escapeHtml, errorMessage, logBackgroundError } from "./utils.ts";
export { maxUploadBytes, appOrigin, previewOrigin } from "./config.ts";
export { createShare, createShareRecord, checkUploadRate, listMyShares, getPublicShare, reportShare, claimShare, deleteShare, listReports, moderateShare, previewShare, previewHeaders, previewMessage } from "./shares.ts";

