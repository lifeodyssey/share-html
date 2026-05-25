import type { PublicShare, RiskReason, ShareRecord } from "../shared/types";

type Env = {
  ASSETS: Fetcher;
  SHARE_HTML_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_REST_KEY: string;
  WORKER_API_SECRET: string;
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

const SLUG_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SHORT_LINK_HOSTS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "buff.ly"];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ event: "unhandled_error", message: errorMessage(error) }));
      return json({ error: "Internal server error" }, 500);
    }
  }
};

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
  const expiresAt = user ? null : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
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
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
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
