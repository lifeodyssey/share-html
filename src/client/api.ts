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
  if (!res.ok) throw new Error(payload?.error ?? fallback);
  return payload as T;
}

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
  return expectOk<UploadResult>(response, "Upload failed");
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
