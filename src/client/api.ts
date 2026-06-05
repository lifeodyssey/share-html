import type { PublicShare } from "../shared/types";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type AppConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export type UploadResult = {
  share: PublicShare;
  claimToken: string | null;
  message: string;
};

export type ApiError = {
  error?: string;
};

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Fetches the client-side app configuration from the worker.
 * GET /api/config
 */
export async function fetchConfig(): Promise<AppConfig> {
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
  accessToken?: string
): Promise<UploadResult> {
  const body = new FormData();
  body.set("file", file);
  body.set("title", title);

  const response = await fetch("/api/shares", {
    method: "POST",
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
    body
  });
  const payload = (await response.json()) as UploadResult & ApiError;
  if (!response.ok) throw new Error(payload.error ?? "Upload failed");
  return payload;
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
  const payload = (await response.json()) as { shares?: PublicShare[] } & ApiError;
  if (!response.ok) throw new Error(payload.error ?? "Could not load shares");
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
  if (!response.ok) throw new Error("Delete failed.");
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
  const payload = (await response.json()) as ApiError;
  if (!response.ok) throw new Error(payload.error ?? "Claim failed.");
}

/**
 * Fetches the public metadata for a share by slug (unauthenticated).
 * GET /api/public/shares/:slug
 *
 * @param slug - URL-safe slug identifying the share
 */
export async function fetchPublicShare(slug: string): Promise<PublicShare> {
  const response = await fetch(`/api/public/shares/${slug}`);
  const payload = (await response.json()) as { share?: PublicShare } & ApiError;
  if (!response.ok || !payload.share) throw new Error(payload.error ?? "Share not found");
  return payload.share;
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
  if (!response.ok) throw new Error("Report failed.");
}
