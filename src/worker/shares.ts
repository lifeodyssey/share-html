import type { ShareRecord } from "../shared/types.ts";
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
  numberEnv,
  sanitizeShortText,
  sha256Hex,
} from "./utils.ts";
import {
  createSecretToken,
  createUniqueSlug,
  getShareBySlug,
  logShareEvent,
  requireWorkerDatabaseAccess,
  restInsert,
  restSelect,
  restUpdate,
  toPublicShare,
} from "./db.ts";
import { scanHtml } from "./scan.ts";
import {
  type AuthUser,
  getOptionalUser,
  requireUser,
  requireAdmin,
} from "./auth.ts";
import { json, readJson } from "./http.ts";

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

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8"
};

export async function createShare(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

export async function createShareRecord(
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

export async function checkUploadRate(env: Env, user: AuthUser | null, ipHash: string): Promise<{ allowed: boolean; reason?: string }> {
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

export async function listMyShares(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const shares = await restSelect<ShareRecord>(
    env,
    `shares?select=*&owner_user_id=eq.${user.id}&deleted_at=is.null&order=created_at.desc&limit=100`
  );

  return json({ shares: shares.map((share) => toPublicShare(share, request, env)) });
}

export async function getPublicShare(slug: string, request: Request, env: Env): Promise<Response> {
  const share = await getShareBySlug(env, slug);
  if (!share || share.deleted_at) return json({ error: "Share not found" }, 404);

  return json({ share: toPublicShare(share, request, env) });
}

export async function reportShare(shareId: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

export async function claimShare(shareId: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

export async function deleteShare(shareId: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

export async function listReports(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const reports = await restSelect(env, "reports?select=*&status=eq.open&order=created_at.desc&limit=100");
  return json({ reports });
}

export async function moderateShare(shareId: string, action: "block" | "unblock", request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

export function previewHeaders(request: Request, env: Env, extra: HeadersInit = {}): Headers {
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

export function previewMessage(message: string, status: number, request: Request, env: Env): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>Share unavailable</title><body style="font-family: ui-sans-serif, system-ui; margin: 2rem; color: #26322f;"><h1>Share unavailable</h1><p>${escapeHtml(message)}</p></body>`;
  return new Response(html, {
    status,
    headers: previewHeaders(request, env, { ...HTML_HEADERS, "cache-control": "no-store" })
  });
}
