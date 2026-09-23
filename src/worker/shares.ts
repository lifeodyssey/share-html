import { trackEvent, parseUploadAnalytics, type Acquisition } from "./analytics.ts";
import type { PublicShare, ShareRecord, ShareVisibility } from "../shared/types.ts";
import {
  cleanTitle,
  errorMessage,
  escapeHtml,
  formatBytes,
  getClientIp,
  hashText,
  isUploadFile,
  logBackgroundError,
  looksLikeHtml,
  sanitizeShortText,
  sha256Hex,
} from "./utils.ts";
import { appOrigin, maxUploadBytes } from "./config.ts";
import {
  claimShareRow,
  countRecentUploadsByIp,
  countRecentUploadsByUser,
  createSecretToken,
  createUniqueSlug,
  findClaimableShare,
  findUserShares,
  getOpenReports,
  getShareBySlug,
  insertReport,
  insertShare,
  insertShareAsset,
  logShareEvent,
  requireWorkerDatabaseAccess,
  rotateShareAccessKeyRow,
  setShareModeration,
  softDeleteShare,
  toPublicShare,
  updateShareScanResult,
} from "./db.ts";
import {
  createMetadataGrant,
  createPreviewGrant,
  createShareAccessKey,
  CURRENT_SHARE_ACCESS_KEY_VERSION,
  hashShareAccessKey,
  metadataGrantCookie,
  previewGrantCookie,
  readMetadataGrant,
  readPreviewGrant,
  verifyPreviewGrant,
  verifyMetadataGrant,
  verifyShareAccessKey,
} from "./share-access.ts";
import { scanHtml } from "./scan.ts";
import {
  type AuthUser,
  getOptionalUser,
  requireUser,
  requireAdmin,
} from "./auth.ts";
import { json, readJson, withDiscoveryHeaders } from "./http.ts";
import { USER_CONTENT_SIGNAL } from "./constants.ts";

type Env = {
  ANALYTICS_ENABLED?: string;
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
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8"
};

const NO_INDEX = "noindex, nofollow, noarchive, nosnippet, noimageindex";
const GROWTH_SOURCE_PATTERN = /^[a-z0-9_-]{1,64}$/;

export async function createShare(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const attribution: { session_id?: string; acquisition?: Acquisition; legacy_source?: string } = {};
  try {
    const response = await createShareFromForm(request, env, ctx, attribution);
    trackEvent(request, env, ctx, { event_name: response.status < 400 ? "share_created" : "share_create_failed", transport: "http_api", status: response.status, outcome: response.status === 202 ? "blocked" : response.status < 400 ? "success" : "failure", ...attribution });
    return response;
  } catch (error) {
    trackEvent(request, env, ctx, { event_name: "share_create_failed", transport: "http_api", status: 500, outcome: "failure", ...attribution });
    throw error;
  }
}

async function createShareFromForm(request: Request, env: Env, ctx: ExecutionContext, attribution: { session_id?: string; acquisition?: Acquisition; legacy_source?: string }): Promise<Response> {
  requireWorkerDatabaseAccess(env);

  const user = await getOptionalUser(request, env);
  if (user?.banned_at) {
    return json({ error: "This account is not allowed to upload." }, 403);
  }

  const form = await request.formData();
  const rawSource = typeof form.get("source") === "string" ? (form.get("source") as string) : "";
  const source = GROWTH_SOURCE_PATTERN.test(rawSource) ? rawSource : "api";
  attribution.legacy_source = source;

  Object.assign(attribution, parseUploadAnalytics(form.get("analytics")));
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
  const visibilityValue = form.get("visibility");
  const visibility = visibilityValue === null || visibilityValue === "public_unlisted"
    ? "public_unlisted"
    : visibilityValue === "private_link"
    ? "private_link"
    : null;
  if (!visibility) {
    return shareJson({ error: "Visibility must be public_unlisted or private_link." }, 422);
  }

  const result = await createShareRecord(env, ctx, request, { html, title, user, visibility, source });
  return shareJson(result.body, result.status);
}

export async function createShareRecord(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  opts: {
    html: string;
    title: string;
    user: AuthUser | null;
    visibility?: ShareVisibility;
    source?: string;
  }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const {
    html,
    title,
    user,
    visibility = "public_unlisted",
    source = "api",
  } = opts;

  const ipHash = await hashText(getClientIp(request), env.IP_HASH_SALT ?? env.WORKER_API_SECRET);
  const uaHash = await hashText(request.headers.get("user-agent") ?? "unknown", env.IP_HASH_SALT ?? env.WORKER_API_SECRET);

  const rateLimit = await checkUploadRate(env, user, ipHash);
  if (!rateLimit.allowed) {
    return { status: 429, body: { error: rateLimit.reason } };
  }

  const byteLength = new TextEncoder().encode(html).length;
  const maxBytes = maxUploadBytes(env, user !== null);
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
  const accessKey = visibility === "private_link" ? createShareAccessKey() : null;
  const accessKeyHash = accessKey ? await hashShareAccessKey(accessKey, env) : null;
  const contentHash = await sha256Hex(html);
  const scan = scanHtml(html);
  const now = new Date();
  const expiresAt = user ? null : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const cleanedTitle = cleanTitle(title, html);
  const r2Prefix = `shares/${shareId}/`;
  const r2Key = `${r2Prefix}index.html`;

  await insertShare(env, {
    id: shareId,
    slug,
    owner_user_id: user?.id ?? null,
    title: cleanedTitle,
    entry_path: "index.html",
    r2_prefix: r2Prefix,
    size_bytes: byteLength,
    content_hash: contentHash,
    visibility,
    access_key_hash: accessKeyHash,
    access_key_version: accessKey ? CURRENT_SHARE_ACCESS_KEY_VERSION : null,
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

    await insertShareAsset(env, {
      share_id: shareId,
      path: "index.html",
      r2_key: r2Key,
      content_type: "text/html; charset=utf-8",
      size_bytes: byteLength,
      content_hash: contentHash
    });

    const [share] = await updateShareScanResult(env, shareId, {
      lifecycle_status: scan.lifecycle,
      moderation_status: scan.status
    });
    if (!share) {
      throw new Error(`scan-result update for share ${shareId} returned no row`);
    }

    ctx.waitUntil(logShareEvent(env, shareId, user?.id ?? null, "created", ipHash, uaHash, {
      risk_score: scan.score,
      visibility,
      source: GROWTH_SOURCE_PATTERN.test(source) ? source : "api",
    }).catch(logBackgroundError));

    return {
      status: scan.lifecycle === "blocked" ? 202 : 201,
      body: {
        share: withAccessKey(toPublicShare(share, request, env), accessKey),
        claimToken,
        accessKey,
        message: scan.lifecycle === "blocked" ? "Uploaded, but blocked by automatic risk checks." : "Uploaded."
      }
    };
  } catch (error) {
    await updateShareScanResult(env, shareId, {
      lifecycle_status: "failed",
      moderation_status: "pending"
    });
    console.error(JSON.stringify({ event: "upload_failed", share_id: shareId, message: errorMessage(error) }));
    return { status: 500, body: { error: "Upload failed after metadata was created." } };
  }
}

export async function checkUploadRate(env: Env, user: AuthUser | null, ipHash: string): Promise<{ allowed: boolean; reason?: string }> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  if (user) {
    const limit = 100;
    const count = await countRecentUploadsByUser(env, user.id, since, limit);
    if (count >= limit) {
      return { allowed: false, reason: "User upload limit reached. Try again later." };
    }
  } else {
    const limit = 10;
    const count = await countRecentUploadsByIp(env, ipHash, since, limit);
    if (count >= limit) {
      return { allowed: false, reason: "Anonymous upload limit reached. Try again later." };
    }
  }

  return { allowed: true };
}

export async function listMyShares(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const shares = await findUserShares(env, user.id);

  return shareJson({ shares: shares.map((share) => toPublicShare(share, request, env)) });
}

export async function getPublicShare(slug: string, request: Request, env: Env): Promise<Response> {
  const share = await getShareBySlug(env, slug);
  if (!share || share.deleted_at) return shareJson({ error: "Share not found." }, 404);
  if (share.visibility === "private_link") {
    return shareJson({ error: "Access key required.", code: "share_access_required" }, 401);
  }

  return shareJson({ share: toPublicShare(share, request, env) });
}

export async function accessShare(
  slug: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const share = await getShareBySlug(env, slug);
  if (!share || share.deleted_at) return shareJson({ error: "Share not found." }, 404);
  if (share.visibility === "public_unlisted") {
    return shareJson({ share: toPublicShare(share, request, env) });
  }

  const body = await readJson<{ accessKey?: string }>(request);
  const user = await getOptionalUser(request, env);
  const ownerAuthorized = Boolean(user && share.owner_user_id === user.id);
  const metadataGrantAuthorized = await verifyMetadataGrant(
    readMetadataGrant(request, slug),
    share,
    env
  );
  const keyAuthorized = await verifyShareAccessKey(
    body.accessKey,
    share.access_key_hash,
    share.access_key_version,
    env
  );
  if (!ownerAuthorized && !metadataGrantAuthorized && !keyAuthorized) {
    const keyWasProvided = typeof body.accessKey === "string" && body.accessKey.length > 0;
    return keyWasProvided
      ? shareJson({ error: "Invalid access key.", code: "invalid_share_access_key" }, 403)
      : shareJson({ error: "Access key required.", code: "share_access_required" }, 401);
  }

  const previewGrant = await createPreviewGrant(share, env);
  const metadataGrant = await createMetadataGrant(share, env);
  const headers = new Headers();
  headers.append("set-cookie", previewGrantCookie(slug, previewGrant, request));
  headers.append("set-cookie", metadataGrantCookie(slug, metadataGrant, request));
  const accessMethod = ownerAuthorized
    ? "owner"
    : keyAuthorized
    ? "access_key"
    : "metadata_grant";
  ctx.waitUntil(
    logShareEvent(env, share.id, ownerAuthorized ? user?.id ?? null : null, "access_granted", null, null, {
      method: accessMethod,
    }).catch(logBackgroundError)
  );
  return shareJson({ share: toPublicShare(share, request, env) }, 200, headers);
}

export async function rotateShareAccessKey(
  shareId: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const accessKey = createShareAccessKey();
  const accessKeyHash = await hashShareAccessKey(accessKey, env);
  const share = await rotateShareAccessKeyRow(
    env,
    shareId,
    user.id,
    accessKeyHash,
    CURRENT_SHARE_ACCESS_KEY_VERSION
  );
  if (!share) return shareJson({ error: "Private share not found." }, 404);

  ctx.waitUntil(
    logShareEvent(env, share.id, user.id, "access_key_rotated", null, null, {}).catch(logBackgroundError)
  );
  return shareJson({
    share: withAccessKey(toPublicShare(share, request, env), accessKey),
    accessKey,
  });
}

export async function reportShare(shareId: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const user = await getOptionalUser(request, env);
  const body = await readJson<{ reason?: string; details?: string }>(request);
  const reason = sanitizeShortText(body.reason, 80) || "other";
  const details = sanitizeShortText(body.details, 1000);
  const ipHash = await hashText(getClientIp(request), env.IP_HASH_SALT ?? env.WORKER_API_SECRET);
  const uaHash = await hashText(request.headers.get("user-agent") ?? "unknown", env.IP_HASH_SALT ?? env.WORKER_API_SECRET);

  await insertReport(env, {
    share_id: shareId,
    reporter_user_id: user?.id ?? null,
    reason,
    details
  });

  ctx.waitUntil(logShareEvent(env, shareId, user?.id ?? null, "reported", ipHash, uaHash, { reason }).catch(logBackgroundError));
  return json({ ok: true });
}

export async function claimShare(shareId: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const body = await readJson<{ claimToken?: string }>(request);
  if (!body.claimToken) return json({ error: "Missing claim token." }, 422);

  const claimTokenHash = await hashText(body.claimToken, env.WORKER_API_SECRET);
  const share = await findClaimableShare(env, shareId, claimTokenHash);
  if (!share) return json({ error: "Invalid claim token." }, 403);

  const updated = await claimShareRow(env, shareId, user.id);
  if (!updated) return json({ error: "Invalid claim token." }, 403);

  ctx.waitUntil(logShareEvent(env, shareId, user.id, "claimed", null, null, {}).catch(logBackgroundError));
  return json({ share: toPublicShare(updated, request, env) });
}

export async function deleteShare(shareId: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const updated = await softDeleteShare(env, shareId, user.role === "admin", user.id);

  if (!updated) return json({ error: "Share not found." }, 404);
  ctx.waitUntil(logShareEvent(env, shareId, user.id, "deleted", null, null, {}).catch(logBackgroundError));
  return json({ ok: true });
}

export async function listReports(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const reports = await getOpenReports(env);
  return json({ reports });
}

export async function moderateShare(shareId: string, action: "block" | "unblock", request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const patch = action === "block"
    ? { lifecycle_status: "blocked", moderation_status: "blocked" }
    : { lifecycle_status: "active", moderation_status: "clean", risk_score: 0, risk_reasons: [] };

  const share = await setShareModeration(env, shareId, patch);
  if (!share) return json({ error: "Share not found." }, 404);

  ctx.waitUntil(logShareEvent(env, shareId, admin.id, action === "block" ? "blocked" : "unblocked", null, null, {}).catch(logBackgroundError));
  return json({ share: toPublicShare(share, request, env) });
}

export async function previewShare(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
  if (share.visibility === "private_link") {
    const grant = readPreviewGrant(request, slug);
    if (!(await verifyPreviewGrant(grant, share, env))) {
      return previewMessage("Access key required.", 403, request, env);
    }
  }
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

  if (request.method === "GET") {
    trackEvent(request, env, ctx, { event_name: "preview_served", transport: "http_api", status: 200, outcome: "success" });
    ctx.waitUntil(logShareEvent(env, share.id, null, "viewed", null, null, {}).catch(logBackgroundError));
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: previewHeaders(request, env, {
      "content-type": object.httpMetadata?.contentType ?? "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      etag: share.content_hash
    })
  });
}

export function previewHeaders(request: Request, env: Env, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  const origin = appOrigin(env, new URL(request.url).origin);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", NO_INDEX);
  headers.set("content-signal", USER_CONTENT_SIGNAL);
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  // PREVIEW_ORIGIN may intentionally differ from APP_ORIGIN for public
  // previews. CSP frame-ancestors remains the embedding allowlist.
  headers.set("cross-origin-resource-policy", "cross-origin");
  headers.set(
    "content-security-policy",
    [
      "default-src 'self' https: data: blob:",
      "script-src 'unsafe-inline' 'unsafe-eval' https: blob:",
      "style-src 'unsafe-inline' https:",
      "img-src https: data: blob:",
      "connect-src https:",
      `frame-ancestors 'self' ${origin}`,
      "base-uri 'none'",
      "sandbox allow-scripts allow-forms allow-popups allow-downloads"
    ].join("; ")
  );
  return headers;
}

export function previewMessage(message: string, status: number, request: Request, env: Env): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>Share unavailable</title><body style="font-family: ui-sans-serif, system-ui; margin: 2rem; color: #26322f;"><h1>Share unavailable</h1><p>${escapeHtml(message)}</p></body>`;
  return new Response(html, {
    status,
    headers: previewHeaders(request, env, { ...HTML_HEADERS, "cache-control": "no-store" })
  });
}

function withAccessKey(share: PublicShare, accessKey: string | null): PublicShare {
  if (!accessKey) return share;
  return {
    ...share,
    share_url: `${share.share_url}#key=${encodeURIComponent(accessKey)}`,
  };
}

function shareJson(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  headers.set("pragma", "no-cache");
  headers.set("x-robots-tag", NO_INDEX);
  headers.set("content-signal", USER_CONTENT_SIGNAL);
  return withDiscoveryHeaders(new Response(JSON.stringify(body), { status, headers }));
}
