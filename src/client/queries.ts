/**
 * TanStack Query hooks wrapping the typed API client.
 *
 * All hooks follow the pattern:
 *   - queries  → useQuery / useSuspenseQuery
 *   - mutations → useMutation with invalidation on success
 *
 * Export `createQueryClient` (factory) so each test can get a fresh client
 * with no retries, and `queryClient` (singleton) for the production app.
 */
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { AppConfig, UploadResult } from "./api";
import {
  claimShare as apiClaimShare,
  deleteShare as apiDeleteShare,
  fetchConfig,
  fetchPublicShare,
  listShares,
  reportShare as apiReportShare,
  uploadShare as apiUploadShare,
} from "./api";
import type { PublicShare } from "../shared/types";

// ---------------------------------------------------------------------------
// Query key catalogue
// ---------------------------------------------------------------------------

export const queryKeys = {
  config: ["config"] as const,
  myShares: (token: string) => ["myShares", token] as const,
  publicShare: (slug: string) => ["publicShare", slug] as const,
};

// ---------------------------------------------------------------------------
// QueryClient factory / singleton
// ---------------------------------------------------------------------------

/**
 * Creates a fresh QueryClient – useful in tests where each suite needs an
 * isolated client with retries disabled.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/** Singleton instance for the production application. */
export const queryClient = createQueryClient();

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetches the worker-side app config (supabaseUrl, supabasePublishableKey).
 * Query key: ['config']
 */
export function useConfig() {
  return useQuery<AppConfig, Error>({
    queryKey: queryKeys.config,
    queryFn: fetchConfig,
  });
}

/**
 * Lists all shares owned by the authenticated user.
 * Query key: ['myShares', accessToken]
 * Only runs when `accessToken` is a non-empty string.
 *
 * @param accessToken - Supabase JWT; pass undefined / null / '' to disable.
 */
export function useMyShares(accessToken: string | null | undefined) {
  return useQuery<PublicShare[], Error>({
    queryKey: queryKeys.myShares(accessToken ?? ""),
    queryFn: () => listShares(accessToken!),
    enabled: !!accessToken,
  });
}

/**
 * Fetches the public metadata for a share by slug (unauthenticated).
 * Query key: ['publicShare', slug]
 */
export function usePublicShare(slug: string) {
  return useQuery<PublicShare, Error>({
    queryKey: queryKeys.publicShare(slug),
    queryFn: () => fetchPublicShare(slug),
    enabled: !!slug,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Uploads an HTML file to create a new share.
 * On success, invalidates ['myShares'] so the list refreshes automatically.
 */
export function useUploadShare() {
  const qc = useQueryClient();
  return useMutation<
    UploadResult,
    Error,
    { file: File; title: string; accessToken?: string }
  >({
    mutationFn: ({ file, title, accessToken }) =>
      apiUploadShare(file, title, accessToken),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["myShares"] });
    },
  });
}

/**
 * Soft-deletes a share owned by the authenticated user.
 * On success, invalidates ['myShares'].
 */
export function useDeleteShare() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; accessToken: string }>({
    mutationFn: ({ id, accessToken }) => apiDeleteShare(id, accessToken),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["myShares"] });
    },
  });
}

/**
 * Claims an anonymous share and attaches it to the authenticated account.
 * On success, invalidates ['myShares'].
 */
export function useClaimShare() {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { shareId: string; claimToken: string; accessToken: string }
  >({
    mutationFn: ({ shareId, claimToken, accessToken }) =>
      apiClaimShare(shareId, claimToken, accessToken),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["myShares"] });
    },
  });
}

/**
 * Submits a moderation report for a share.
 * Does NOT invalidate any query (reports have no list to refresh).
 */
export function useReportShare() {
  return useMutation<
    void,
    Error,
    { shareId: string; reason: string; details: string; accessToken?: string }
  >({
    mutationFn: ({ shareId, reason, details, accessToken }) =>
      apiReportShare(shareId, reason, details, accessToken),
  });
}
