import {
  errorMessage,
  escapeHtml,
} from "./utils.ts";
import {
  buildAuthEmailPlan,
  parseSupabaseSendEmailPayload,
  verifyStandardWebhookSignature
} from "./auth-email.ts";
import { LLMS_TXT, SHARE_HTML_SKILL, SITE_ORIGIN, USER_CONTENT_SIGNAL } from "./constants.ts";
import {
  acceptsMarkdown,
  corsHeaders,
  etaggedJsonResponse,
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
  mcpRegistryManifest,
  oauthAuthorizationServer,
  oauthProtectedResource,
  openApiDocument,
  robotsTxt,
  securityTxt,
  sitemapXml,
  webMcpManifest
} from "./discovery.ts";
import {
  EXAMPLE_TEMPLATES,
  marketingPageForPath,
  type MarketingPage,
} from "../shared/marketing.ts";
import {
  createShare,
  accessShare,
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
  rotateShareAccessKey,
} from "./shares.ts";
import { handleMcpRequest } from "./mcp.ts";
import { getShareBySlug } from "./db.ts";
import { handleA2aRequest } from "./a2a.ts";

type Env = {
  ASSETS: Fetcher;
  AUTH_EMAIL?: SendEmail;
  SHARE_HTML_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_REST_KEY: string;
  WORKER_API_SECRET: string;
  SHARE_ACCESS_PEPPER_V1: string;
  PREVIEW_GRANT_SIGNING_KEY_V1: string;
  SUPABASE_SEND_EMAIL_HOOK_SECRET?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_FROM_NAME?: string;
  APP_ORIGIN?: string;
  PREVIEW_ORIGIN?: string;
  IP_HASH_SALT?: string;
  MAX_ANON_HTML_BYTES?: string;
  MAX_USER_HTML_BYTES?: string;
  INDEXNOW_KEY?: string;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const discoveryResponse = discoveryRoute(request, url, env);

    if (discoveryResponse) {
      return withDiscoveryHeaders(discoveryResponse);
    }

    if (url.pathname === "/mcp") {
      return await handleMcpRequest(request, env, ctx);
    }

    if (url.pathname === "/a2a") {
      return await handleA2aRequest(request);
    }

    if (url.pathname === "/" && acceptsMarkdown(request)) {
      return varyAccept(withDiscoveryHeaders(textResponse(LLMS_TXT, "text/markdown; charset=utf-8", request.method)));
    }

    const marketingPage = marketingPageForPath(url.pathname);
    if (marketingPage) {
      if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
      return await serveMarketingRoute(request, env, marketingPage);
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

      const accessShareMatch = url.pathname.match(/^\/api\/shares\/([^/]+)\/access$/);
      if (accessShareMatch) {
        if (request.method !== "POST") return methodNotAllowed("POST");
        return await accessShare(accessShareMatch[1], request, env, ctx);
      }

      const rotateAccessKeyMatch = url.pathname.match(/^\/api\/shares\/([0-9a-f-]+)\/access-key$/);
      if (rotateAccessKeyMatch) {
        if (request.method !== "POST") return methodNotAllowed("POST");
        return await rotateShareAccessKey(rotateAccessKeyMatch[1], request, env, ctx);
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

      if (url.pathname.startsWith("/v/") && (request.method === "GET" || request.method === "HEAD")) {
        return await previewShare(request, env, ctx);
      }

      if (url.pathname.startsWith("/v/")) return methodNotAllowed("GET, HEAD");

      if (isShareRoute(url.pathname)) {
        if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
        return await serveShareRoute(request, env);
      }

      if (isExampleAssetRoute(url.pathname)) {
        if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
        return await serveExampleAsset(request, env);
      }

      const assetResponse = await env.ASSETS.fetch(request);
      const contentType = assetResponse.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        if (url.pathname !== "/") return notFoundHtml(request.method);
        if (request.method === "HEAD") {
          return varyAccept(withDiscoveryHeaders(new Response(null, { headers: assetResponse.headers })));
        }
        if (request.method === "GET") {
          return varyAccept(withDiscoveryHeaders(await injectConfig(assetResponse, env, request)));
        }
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
async function injectConfig(
  response: Response,
  env: Env,
  request: Request,
  options: { fallback?: string; privateShare?: boolean; marketingPage?: MarketingPage } = {}
): Promise<Response> {
  const configScript = `<script>window.__APP_CONFIG__=${JSON.stringify({
    supabaseUrl: env.SUPABASE_URL,
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY
  })}</script>`;
  const html = await response.text();
  const bodyAdjusted = routeFallbackHtml(html, request, options.fallback);
  const headAdjusted = routeSeoHtml(
    bodyAdjusted,
    request,
    env,
    options.privateShare ?? false,
    options.marketingPage
  );
  const injected = headAdjusted.replace("</head>", `${configScript}</head>`);
  return new Response(injected, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

function routeFallbackHtml(html: string, request: Request, fallback?: string): string {
  const pathname = new URL(request.url).pathname;
  if (fallback === undefined && !isShareRoute(pathname)) return html;
  return replaceMarkedBlock(
    html,
    "<!-- share-html:fallback:start -->",
    "<!-- share-html:fallback:end -->",
    fallback ?? shareRouteFallback()
  );
}

function isShareRoute(pathname: string): boolean {
  return /^\/s\/[^/]+\/?$/.test(pathname);
}

function replaceMarkedBlock(
  html: string,
  startMarker: string,
  endMarker: string,
  replacement: string
): string {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) return html;

  const contentStart = start + startMarker.length;
  return `${html.slice(0, contentStart)}\n${replacement}\n      ${html.slice(end)}`;
}

function routeSeoHtml(
  html: string,
  request: Request,
  env: Env,
  privateShare: boolean,
  marketingPage?: MarketingPage
): string {
  const url = new URL(request.url);
  if (marketingPage) {
    return replaceMarkedBlock(
      html,
      "<!-- share-html:seo:start -->",
      "<!-- share-html:seo:end -->",
      marketingSeoHtml(marketingPage, env.APP_ORIGIN ?? url.origin)
    );
  }
  const match = url.pathname.match(/^\/s\/([^/]+)\/?$/);
  if (!match) return html;

  const origin = escapeHtml(env.APP_ORIGIN ?? url.origin);
  const slug = escapeHtml(encodeURIComponent(match[1]));
  const pageTitle = privateShare ? "Protected HTML share" : "Shared HTML preview";
  const description = privateShare
    ? "Open an access-key-protected, sandboxed HTML preview on Share HTML."
    : "Open an unlisted, sandboxed HTML preview on Share HTML.";
  const canonical = `${origin}/s/${slug}`;
  const meta = [
    `    <meta name="description" content="${description}" />`,
    `    <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />`,
    `    <link rel="canonical" href="${canonical}" />`,
    '    <meta property="og:type" content="website" />',
    '    <meta property="og:site_name" content="Share HTML" />',
    `    <meta property="og:url" content="${canonical}" />`,
    `    <meta property="og:title" content="${pageTitle} | Share HTML" />`,
    `    <meta property="og:description" content="${description}" />`,
    `    <meta property="og:image" content="${origin}/og.png" />`,
    '    <meta name="twitter:card" content="summary_large_image" />',
    `    <meta name="twitter:title" content="${pageTitle} | Share HTML" />`,
    `    <meta name="twitter:description" content="${description}" />`,
    `    <meta name="twitter:image" content="${origin}/og.png" />`,
    `    <title>${pageTitle} | Share HTML</title>`,
  ].join("\n");
  return replaceMarkedBlock(
    html,
    "<!-- share-html:seo:start -->",
    "<!-- share-html:seo:end -->",
    meta
  );
}

function marketingSeoHtml(page: MarketingPage, rawOrigin: string): string {
  const origin = rawOrigin.replace(/\/$/, "");
  const canonical = origin + page.path;
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": page.schemaType,
    "@id": canonical + "#page",
    url: canonical,
    name: page.title,
    description: page.description,
    isPartOf: {
      "@type": "WebSite",
      "@id": origin + "/#website",
      url: origin + "/",
      name: "Share HTML",
    },
    about: {
      "@type": "WebApplication",
      "@id": origin + "/#app",
      name: "Share HTML",
    },
  }).replace(/</g, "\\u003c");
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const escapedCanonical = escapeHtml(canonical);
  const escapedOrigin = escapeHtml(origin);

  return [
    '    <meta name="description" content="' + description + '" />',
    '    <meta name="robots" content="index, follow, max-image-preview:large" />',
    '    <link rel="canonical" href="' + escapedCanonical + '" />',
    '    <meta property="og:type" content="website" />',
    '    <meta property="og:site_name" content="Share HTML" />',
    '    <meta property="og:url" content="' + escapedCanonical + '" />',
    '    <meta property="og:title" content="' + title + '" />',
    '    <meta property="og:description" content="' + description + '" />',
    '    <meta property="og:image" content="' + escapedOrigin + '/og.png" />',
    '    <meta name="twitter:card" content="summary_large_image" />',
    '    <meta name="twitter:title" content="' + title + '" />',
    '    <meta name="twitter:description" content="' + description + '" />',
    '    <meta name="twitter:image" content="' + escapedOrigin + '/og.png" />',
    '    <script type="application/ld+json">' + schema + '</script>',
    '    <title>' + title + '</title>',
  ].join("\n");
}

function marketingPageFallback(page: MarketingPage): string {
  const sections = page.sections.map((section, index) => {
    const paragraphs = section.paragraphs
      .map((paragraph) => '            <p>' + escapeHtml(paragraph) + '</p>')
      .join("\n");
    const bullets = section.bullets
      ? [
          '            <ul>',
          ...section.bullets.map((bullet) => '              <li>' + escapeHtml(bullet) + '</li>'),
          '            </ul>',
        ].join("\n")
      : "";
    const code = section.code
      ? '            <pre><code>' + escapeHtml(section.code) + '</code></pre>'
      : "";
    const links = section.links
      ? [
          '            <div class="marketing-resource-links">',
          ...section.links.map((link) =>
            '              <a class="button secondary" href="' +
            escapeHtml(link.href) +
            '">' +
            escapeHtml(link.label) +
            '</a>'
          ),
          '            </div>',
        ].join("\n")
      : "";

    return [
      '        <section class="marketing-section">',
      '          <p class="marketing-section-number" aria-hidden="true">' +
        String(index + 1).padStart(2, "0") +
        '</p>',
      '          <div>',
      '            <h2>' + escapeHtml(section.title) + '</h2>',
      paragraphs,
      bullets,
      code,
      links,
      '          </div>',
      '        </section>',
    ].filter(Boolean).join("\n");
  }).join("\n");

  return [
    '      <main class="app-shell">',
    '        <article class="marketing-page">',
    '          <header class="marketing-hero">',
    '            <p class="text-xs font-semibold tracking-widest uppercase text-muted mb-3">' +
      escapeHtml(page.eyebrow) +
      '</p>',
    '            <h1>' + escapeHtml(page.heading) + '</h1>',
    '            <p class="marketing-lead">' + escapeHtml(page.lead) + '</p>',
    '            <div class="marketing-actions">',
    '              <a class="button primary" href="' +
      escapeHtml(page.primaryCta.href) +
      '">' +
      escapeHtml(page.primaryCta.label) +
      '</a>',
    page.secondaryCta
      ? '              <a class="button secondary" href="' +
        escapeHtml(page.secondaryCta.href) +
        '">' +
        escapeHtml(page.secondaryCta.label) +
        '</a>'
      : "",
    '            </div>',
    '          </header>',
    '          <div class="marketing-sections">',
    sections,
    '          </div>',
    '        </article>',
    '      </main>',
  ].filter(Boolean).join("\n");
}

async function serveMarketingRoute(
  request: Request,
  env: Env,
  page: MarketingPage
): Promise<Response> {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=300, s-maxage=3600",
    vary: "Accept",
  });
  if (request.method === "HEAD") {
    return withDiscoveryHeaders(new Response(null, { headers }));
  }

  const assetResponse = await env.ASSETS.fetch(request);
  const injected = await injectConfig(assetResponse, env, request, {
    fallback: marketingPageFallback(page),
    marketingPage: page,
  });
  for (const [name, value] of headers) injected.headers.set(name, value);
  return withDiscoveryHeaders(new Response(injected.body, { headers: injected.headers }));
}

function isExampleAssetRoute(pathname: string): boolean {
  return EXAMPLE_TEMPLATES.some((example) => example.fileUrl === pathname);
}

async function serveExampleAsset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  if (!response.ok) return notFoundHtml(request.method);

  const headers = new Headers(response.headers);
  const filename = new URL(request.url).pathname.split("/").pop() ?? "example.html";
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("content-disposition", 'attachment; filename="' + filename.replace(/[^a-z0-9.-]/gi, "") + '"');
  headers.set("cache-control", "public, max-age=86400");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return withDiscoveryHeaders(new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers,
  }));
}

function shareRouteFallback(): string {
  return [
    '      <main class="app-shell" aria-busy="true">',
    '        <section class="flex flex-col gap-6 pt-8 border-t border-border">',
    '          <p class="text-sm text-muted" aria-live="polite">Loading share...</p>',
    "        </section>",
    "      </main>",
  ].join("\n");
}

function shareRouteUnavailable(message: string): string {
  return [
    '      <main class="app-shell">',
    '        <section class="flex flex-col gap-6 pt-8 border-t border-border">',
    `          <p class="text-sm text-muted" role="status">${escapeHtml(message)}</p>`,
    "        </section>",
    "      </main>",
  ].join("\n");
}

async function serveShareRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.pathname.match(/^\/s\/([^/]+)\/?$/)?.[1] ?? "";
  const share = await getShareBySlug(env, slug);

  let status = 200;
  let message = "Loading share...";
  if (!share || share.deleted_at) {
    status = 404;
    message = "Share not found.";
  } else if (share.visibility === "public_unlisted") {
    // A private wrapper request cannot carry the fragment access key. Keep its
    // pre-unlock shell generic so expiry/moderation state is not leaked before
    // the client completes the POST access exchange.
    if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
      status = 410;
      message = "This share has expired.";
    } else if (share.lifecycle_status === "blocked") {
      status = 403;
      message = "This share was blocked by moderation.";
    } else if (share.lifecycle_status !== "active" && share.lifecycle_status !== "needs_review") {
      status = 409;
      message = "This share is not ready yet.";
    }
  }

  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
    "content-signal": USER_CONTENT_SIGNAL,
    "referrer-policy": "no-referrer",
    vary: "Accept",
  });
  if (request.method === "HEAD") {
    return withDiscoveryHeaders(new Response(null, { status, headers }));
  }

  const assetResponse = await env.ASSETS.fetch(request);
  const fallback = status === 200 ? shareRouteFallback() : shareRouteUnavailable(message);
  const injected = await injectConfig(assetResponse, env, request, {
    fallback,
    privateShare: share?.visibility === "private_link",
  });
  for (const [name, value] of headers) injected.headers.set(name, value);
  return withDiscoveryHeaders(new Response(injected.body, { status, headers: injected.headers }));
}

function notFoundHtml(method: string): Response {
  const body = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found | Share HTML</title><body><h1>Not found</h1></body></html>';
  return withDiscoveryHeaders(new Response(method === "HEAD" ? null : body, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
    },
  }));
}

function varyAccept(response: Response): Response {
  const headers = new Headers(response.headers);
  const vary = headers.get("vary");
  headers.set("vary", vary ? `${vary}, Accept` : "Accept");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function discoveryRoute(request: Request, url: URL, env: Env): Response | null {
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

  const indexNowKey = env.INDEXNOW_KEY?.trim();
  if (
    indexNowKey &&
    /^[A-Za-z0-9-]{8,128}$/.test(indexNowKey) &&
    url.pathname === "/" + indexNowKey + ".txt"
  ) {
    return new Response(request.method === "HEAD" ? null : indexNowKey, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "private, no-store",
        "content-signal": USER_CONTENT_SIGNAL,
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
      },
    });
  }

  if (url.pathname === "/openapi.json") {
    return jsonResponse(openApiDocument(), "application/openapi+json; charset=utf-8", request.method);
  }

  if (url.pathname === "/server.json") {
    return jsonResponse(mcpRegistryManifest(), "application/json; charset=utf-8", request.method);
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
    return etaggedJsonResponse(
      a2aAgentCard(),
      "application/json; charset=utf-8",
      request,
      '"share-html-a2a-1.0.0"'
    );
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
export { countRecentUploadsByIp, countRecentUploadsByUser, insertShare, insertShareAsset, updateShareScanResult, findUserShares, insertReport, getOpenReports, findClaimableShare, claimShareRow, rotateShareAccessKeyRow, softDeleteShare, setShareModeration, getUserProfile, insertUserProfile } from "./db.ts";
export { getUserFromToken, getOptionalUser, requireUser, requireAdmin } from "./auth.ts";
export type { AuthUser } from "./auth.ts";
export { cleanTitle, sanitizeShortText, looksLikeHtml, isUploadFile, getClientIp, sha256Hex, hashText, base64Url, numberEnv, formatBytes, escapeHtml, errorMessage, logBackgroundError } from "./utils.ts";
export { maxUploadBytes, appOrigin, previewOrigin } from "./config.ts";
export { createShare, createShareRecord, checkUploadRate, listMyShares, getPublicShare, accessShare, rotateShareAccessKey, reportShare, claimShare, deleteShare, listReports, moderateShare, previewShare, previewHeaders, previewMessage } from "./shares.ts";
