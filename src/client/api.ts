import type { PublicShare, ShareVisibility } from "../shared/types";
import { trackBrowserEvent, trackBrowserUploadSuccess, uploadAnalyticsContext } from "./analytics";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type AppConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  analyticsEnabled?: boolean;
  ga4MeasurementId?: string;
};

export type UploadResult = {
  share: PublicShare;
  claimToken: string | null;
  accessKey: string | null;
  message: string;
};

export type RotateAccessKeyResult = {
  share: PublicShare;
  accessKey: string;
};

export type ApiError = {
  error?: string;
  code?: string;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Asserts the response is ok and returns the parsed JSON body.
 * If the server included an `error` field in the payload, that message is
 * used; otherwise `fallback` is thrown. Non-JSON error bodies fall back to
 * `fallback` rather than surfacing a parse error.
 */
async function expectOk<T>(res: Response, fallback: string): Promise<T> {
  let payload: (T & ApiError) | null = null;
  try {
    payload = (await res.json()) as T & ApiError;
  } catch {
    if (!res.ok) throw new Error(fallback);
  }
  if (!res.ok) throw new ApiRequestError(payload?.error ?? fallback, res.status, payload?.code);
  return payload as T;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Fetches the client-side app configuration from the worker.
 * GET /api/config
 *
 * If the worker injected the config via a <script> tag (window.__APP_CONFIG__),
 * that is used immediately without a network round-trip.
 */
export async function fetchConfig(): Promise<AppConfig> {
  const injected = (globalThis as Record<string, unknown>).__APP_CONFIG__ as AppConfig | undefined;
  if (injected?.supabaseUrl && injected?.supabasePublishableKey) {
    return injected;
  }
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error("Config unavailable");
  return response.json() as Promise<AppConfig>;
}

/**
 * Uploads an HTML file to create a new share.
 * POST /api/shares (multipart/form-data)
 *
 * @param file - The HTML file to upload
 * @param title - Optional title for the share
 * @param accessToken - Optional Supabase JWT for authenticated uploads
 */
export async function uploadShare(
  file: File,
  title: string,
  visibility: ShareVisibility,
  accessToken?: string,
  source?: string
): Promise<UploadResult> {
  const body = new FormData();
  body.set("file", file);
  body.set("title", title);
  body.set("visibility", visibility);
  if (source) body.set("source", source);

  const analytics = uploadAnalyticsContext();
  if (analytics) body.set("analytics", JSON.stringify(analytics));
  if (analytics) trackBrowserEvent("upload_started");

  try {
    const response = await fetch("/api/shares", {
      method: "POST",
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      body
    });
    const result = await expectOk<UploadResult>(response, "Upload failed");
    if (analytics && result.share.lifecycle_status === "active") trackBrowserUploadSuccess();
    return result;
  } catch (error) {
    if (analytics) trackBrowserEvent("upload_failed");
    throw error;
  }
}

/**
 * Lists all shares owned by the authenticated user.
 * GET /api/shares
 *
 * @param accessToken - Supabase JWT (required)
 */
export async function listShares(accessToken: string): Promise<PublicShare[]> {
  const response = await fetch("/api/shares", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const payload = await expectOk<{ shares?: PublicShare[] }>(response, "Could not load shares");
  return payload.shares ?? [];
}

/**
 * Soft-deletes a share owned by the authenticated user.
 * DELETE /api/shares/:id
 *
 * @param id - Share UUID
 * @param accessToken - Supabase JWT (required)
 */
export async function deleteShare(id: string, accessToken: string): Promise<void> {
  const response = await fetch(`/api/shares/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` }
  });
  await expectOk<unknown>(response, "Delete failed.");
}

/**
 * Claims an anonymous share and attaches it to the authenticated account.
 * POST /api/shares/:id/claim
 *
 * @param shareId - Share UUID to claim
 * @param claimToken - One-time claim token issued at upload time
 * @param accessToken - Supabase JWT (required)
 */
export async function claimShare(
  shareId: string,
  claimToken: string,
  accessToken: string
): Promise<void> {
  const response = await fetch(`/api/shares/${shareId}/claim`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ claimToken })
  });
  await expectOk<unknown>(response, "Claim failed.");
}

/**
 * Fetches the public metadata for a share by slug (unauthenticated).
 * GET /api/public/shares/:slug
 *
 * @param slug - URL-safe slug identifying the share
 */
export async function fetchPublicShare(slug: string): Promise<PublicShare> {
  const response = await fetch(`/api/public/shares/${slug}`);
  const payload = await expectOk<{ share?: PublicShare }>(response, "Share not found");
  if (!payload.share) throw new Error("Share not found");
  return payload.share;
}

/**
 * Unlocks an access-key protected share, or authorizes its signed-in owner.
 * The access key is sent in the JSON body, never in the request URL. On
 * success the Worker sets separate short-lived HttpOnly grants scoped to the
 * exact metadata-unlock path and /v/:slug.
 */
export async function accessShare(
  slug: string,
  accessKey?: string,
  accessToken?: string
): Promise<PublicShare> {
  const response = await fetch(`/api/shares/${slug}/access`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(accessKey ? { accessKey } : {}),
  });
  const payload = await expectOk<{ share?: PublicShare }>(response, "Could not unlock share");
  if (!payload.share) throw new Error("Share not found");
  return payload.share;
}

/** Rotates the access key for an owned private share. */
export async function rotateShareAccessKey(
  shareId: string,
  accessToken: string
): Promise<RotateAccessKeyResult> {
  const response = await fetch(`/api/shares/${shareId}/access-key`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return expectOk<RotateAccessKeyResult>(response, "Could not rotate access key");
}

/**
 * Submits a moderation report for a share.
 * POST /api/shares/:id/report
 *
 * @param shareId - Share UUID to report
 * @param reason - Reason category (e.g. "phishing", "malware")
 * @param details - Optional free-text details
 * @param accessToken - Optional Supabase JWT
 */
export async function reportShare(
  shareId: string,
  reason: string,
  details: string,
  accessToken?: string
): Promise<void> {
  const response = await fetch(`/api/shares/${shareId}/report`, {
    method: "POST",
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      "content-type": "application/json"
    },
    body: JSON.stringify({ reason, details })
  });
  await expectOk<unknown>(response, "Report failed.");
}
