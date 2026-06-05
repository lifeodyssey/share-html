import type { PublicShare, ShareRecord } from "../shared/types.ts";

// Minimal structural interface covering the env fields used by these helpers.
// The full Env type in index.ts is a superset that satisfies this interface.
type DbEnv = {
  SUPABASE_URL: string;
  SUPABASE_REST_KEY: string;
  WORKER_API_SECRET: string;
  APP_ORIGIN?: string;
  PREVIEW_ORIGIN?: string;
};

const SLUG_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function requireWorkerDatabaseAccess(env: DbEnv): void {
  if (!env.SUPABASE_REST_KEY || !env.WORKER_API_SECRET) {
    throw new Error("SUPABASE_REST_KEY and WORKER_API_SECRET must be configured.");
  }
}

// ---------------------------------------------------------------------------
// Module-private PostgREST primitives — callers use the intent functions below
// ---------------------------------------------------------------------------

async function restRequest<T>(env: DbEnv, path: string, init: RequestInit = {}): Promise<T> {
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

async function restSelect<T>(env: DbEnv, path: string): Promise<T[]> {
  return restRequest<T[]>(env, path, { method: "GET" });
}

async function restInsert<T>(env: DbEnv, table: string, row: Record<string, unknown>): Promise<T> {
  const rows = await restRequest<T[]>(env, `${table}?select=*`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(row)
  });
  return rows[0];
}

async function restUpdate<T>(env: DbEnv, table: string, filter: string, patch: Record<string, unknown>): Promise<T[]> {
  return restRequest<T[]>(env, `${table}?${filter}&select=*`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(patch)
  });
}

// ---------------------------------------------------------------------------
// Public intent-named data-access functions
// ---------------------------------------------------------------------------

// --- Rate limiting ---

/**
 * Count recent uploads for a given IP hash since `sinceIso`, capped at `cap + 1`
 * rows so the caller can detect > cap without a full scan.
 */
export async function countRecentUploadsByIp(
  env: DbEnv,
  ipHash: string,
  sinceIso: string,
  cap: number
): Promise<number> {
  const rows = await restSelect<{ id: string }>(
    env,
    `shares?select=id&creator_ip_hash=eq.${encodeURIComponent(ipHash)}&created_at=gte.${encodeURIComponent(sinceIso)}&limit=${cap + 1}`
  );
  return rows.length;
}

/**
 * Count recent uploads for a given user ID since `sinceIso`, capped at `cap + 1`
 * rows so the caller can detect > cap without a full scan.
 */
export async function countRecentUploadsByUser(
  env: DbEnv,
  userId: string,
  sinceIso: string,
  cap: number
): Promise<number> {
  const rows = await restSelect<{ id: string }>(
    env,
    `shares?select=id&owner_user_id=eq.${userId}&created_at=gte.${encodeURIComponent(sinceIso)}&limit=${cap + 1}`
  );
  return rows.length;
}

// --- Share creation ---

/**
 * Insert a new share row and return the persisted record.
 */
export async function insertShare(env: DbEnv, fields: Record<string, unknown>): Promise<ShareRecord> {
  return restInsert<ShareRecord>(env, "shares", fields);
}

/**
 * Insert a share_assets row (does not return the row).
 */
export async function insertShareAsset(env: DbEnv, fields: Record<string, unknown>): Promise<void> {
  await restInsert(env, "share_assets", fields);
}

/**
 * Update a share's lifecycle and moderation status after scanning.
 * Returns the updated row.
 */
export async function updateShareScanResult(
  env: DbEnv,
  shareId: string,
  patch: Record<string, unknown>
): Promise<ShareRecord[]> {
  return restUpdate<ShareRecord>(env, "shares", `id=eq.${shareId}`, patch);
}

// --- User shares listing ---

/**
 * Return all non-deleted shares owned by `userId`, newest first, up to 100.
 */
export async function findUserShares(env: DbEnv, userId: string): Promise<ShareRecord[]> {
  return restSelect<ShareRecord>(
    env,
    `shares?select=*&owner_user_id=eq.${userId}&deleted_at=is.null&order=created_at.desc&limit=100`
  );
}

// --- Reporting ---

/**
 * Insert a report row.
 */
export async function insertReport(env: DbEnv, fields: Record<string, unknown>): Promise<void> {
  await restInsert(env, "reports", fields);
}

/**
 * Return all open reports, newest first, up to 100.
 */
export async function getOpenReports(env: DbEnv): Promise<unknown[]> {
  return restSelect(
    env,
    "reports?select=*&status=eq.open&order=created_at.desc&limit=100"
  );
}

// --- Claiming ---

/**
 * Find an unclaimed share by ID and claim token hash.
 * Returns the share if the token matches and it has no owner, null otherwise.
 */
export async function findClaimableShare(
  env: DbEnv,
  shareId: string,
  claimTokenHash: string
): Promise<ShareRecord | null> {
  const [share] = await restSelect<ShareRecord>(
    env,
    `shares?select=*&id=eq.${shareId}&claim_token_hash=eq.${encodeURIComponent(claimTokenHash)}&owner_user_id=is.null&limit=1`
  );
  return share ?? null;
}

/**
 * Assign ownership of a share to `userId` and clear the claim token.
 * Returns the updated share row.
 */
export async function claimShareRow(
  env: DbEnv,
  shareId: string,
  userId: string
): Promise<ShareRecord | null> {
  const [updated] = await restUpdate<ShareRecord>(env, "shares", `id=eq.${shareId}`, {
    owner_user_id: userId,
    claim_token_hash: null,
    expires_at: null
  });
  return updated ?? null;
}

// --- Soft deletion ---

/**
 * Soft-delete a share by setting lifecycle_status=deleted and deleted_at.
 * Admins may delete any share; regular users may only delete their own.
 * Returns the updated row, or null if the share was not found / not owned.
 */
export async function softDeleteShare(
  env: DbEnv,
  shareId: string,
  isAdmin: boolean,
  ownerUserId: string
): Promise<ShareRecord | null> {
  const filter = isAdmin
    ? `id=eq.${shareId}`
    : `id=eq.${shareId}&owner_user_id=eq.${ownerUserId}`;
  const [updated] = await restUpdate<ShareRecord>(env, "shares", filter, {
    lifecycle_status: "deleted",
    deleted_at: new Date().toISOString()
  });
  return updated ?? null;
}

// --- Moderation ---

/**
 * Apply a moderation patch to a share by ID.
 * Returns the updated share row, or null if not found.
 */
export async function setShareModeration(
  env: DbEnv,
  shareId: string,
  patch: Record<string, unknown>
): Promise<ShareRecord | null> {
  const [updated] = await restUpdate<ShareRecord>(env, "shares", `id=eq.${shareId}`, patch);
  return updated ?? null;
}

// --- Auth profiles ---

type ProfileRow = { role: "user" | "admin"; banned_at: string | null };

/**
 * Look up a user's profile by Supabase auth UID.
 * Returns the profile row or null if it does not exist yet.
 */
export async function getUserProfile(env: DbEnv, userId: string): Promise<ProfileRow | null> {
  const [profile] = await restSelect<ProfileRow>(
    env,
    `profiles?select=role,banned_at&id=eq.${userId}&limit=1`
  );
  return profile ?? null;
}

/**
 * Insert a new profile row for a freshly-registered user.
 */
export async function insertUserProfile(
  env: DbEnv,
  userId: string,
  displayName: string
): Promise<void> {
  await restInsert(env, "profiles", { id: userId, display_name: displayName });
}

// ---------------------------------------------------------------------------
// Remaining exported domain helpers (unchanged)
// ---------------------------------------------------------------------------

export async function getShareBySlug(env: DbEnv, slug: string): Promise<ShareRecord | null> {
  const [share] = await restSelect<ShareRecord>(env, `shares?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return share ?? null;
}

export async function logShareEvent(
  env: DbEnv,
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

export function randomSlug(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join("");
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function createSecretToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function createUniqueSlug(env: DbEnv): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const slug = randomSlug(10);
    const existing = await restSelect<{ id: string }>(env, `shares?select=id&slug=eq.${slug}&limit=1`);
    if (existing.length === 0) return slug;
  }
  return `${randomSlug(10)}${Date.now().toString(36)}`;
}

export function toPublicShare(share: ShareRecord, request: Request, env: DbEnv): PublicShare {
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
