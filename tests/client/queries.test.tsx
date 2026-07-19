/**
 * Unit tests for TanStack Query hooks in src/client/queries.ts
 *
 * Environment: jsdom (client project in vitest.config.ts)
 *
 * Strategy
 * --------
 * - vi.mock the api module so no network requests occur.
 * - Each suite creates a *fresh* QueryClient (retry:false, gcTime:0) so
 *   cached state never leaks between tests.
 * - We spy on `queryClient.invalidateQueries` via the instance provided by
 *   the wrapper, so we can assert invalidation without needing real fetch.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the entire api module
// ---------------------------------------------------------------------------

vi.mock("../../src/client/api.ts", () => ({
  fetchConfig: vi.fn(),
  listShares: vi.fn(),
  fetchPublicShare: vi.fn(),
  accessShare: vi.fn(),
  uploadShare: vi.fn(),
  rotateShareAccessKey: vi.fn(),
  deleteShare: vi.fn(),
  claimShare: vi.fn(),
  reportShare: vi.fn(),
}));

// Import AFTER vi.mock so we get the mocked versions
import * as api from "../../src/client/api.ts";
import {
  useConfig,
  useClaimShare,
  useDeleteShare,
  useMyShares,
  usePublicShare,
  useReportShare,
  useRotateShareAccessKey,
  useShareAccess,
  useUploadShare,
} from "../../src/client/queries.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFreshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

// ---------------------------------------------------------------------------
// useConfig
// ---------------------------------------------------------------------------

describe("useConfig", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = makeFreshClient();
    vi.mocked(api.fetchConfig).mockResolvedValue({
      supabaseUrl: "https://test.supabase.co",
      supabasePublishableKey: "pk_test",
    });
  });

  afterEach(async () => {
    await client.cancelQueries();
    client.clear();
    vi.clearAllMocks();
  });

  it("fetches config and returns data on success", async () => {
    const { result } = renderHook(() => useConfig(), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      supabaseUrl: "https://test.supabase.co",
      supabasePublishableKey: "pk_test",
    });
    expect(api.fetchConfig).toHaveBeenCalledOnce();
  });

  it("surfaces an error when fetchConfig rejects", async () => {
    vi.mocked(api.fetchConfig).mockRejectedValue(
      new Error("Config unavailable")
    );

    const { result } = renderHook(() => useConfig(), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Config unavailable");
  });
});

// ---------------------------------------------------------------------------
// useMyShares
// ---------------------------------------------------------------------------

describe("useMyShares", () => {
  const fakeShares = [
    { id: "s1", slug: "slug-1" },
    { id: "s2", slug: "slug-2" },
  ];
  let client: QueryClient;

  beforeEach(() => {
    client = makeFreshClient();
    vi.mocked(api.listShares).mockResolvedValue(fakeShares as never);
  });

  afterEach(async () => {
    await client.cancelQueries();
    client.clear();
    vi.clearAllMocks();
  });

  it("fetches shares when userId and token are present", async () => {
    const { result } = renderHook(() => useMyShares("uid-1", "tok-abc"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(fakeShares);
    expect(api.listShares).toHaveBeenCalledWith("tok-abc");
  });

  it("does NOT fetch when userId is absent", async () => {
    const { result } = renderHook(() => useMyShares(null, "tok-abc"), {
      wrapper: makeWrapper(client),
    });

    // Stays in idle/pending state, never fires
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.isFetching).toBe(false);
    expect(api.listShares).not.toHaveBeenCalled();
  });

  it("does NOT fetch when userId is an empty string", async () => {
    const { result } = renderHook(() => useMyShares("", "tok-abc"), {
      wrapper: makeWrapper(client),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.isFetching).toBe(false);
    expect(api.listShares).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// usePublicShare
// ---------------------------------------------------------------------------

describe("usePublicShare", () => {
  const fakeShare = { id: "pub1", slug: "my-slug" };
  let client: QueryClient;

  beforeEach(() => {
    client = makeFreshClient();
    vi.mocked(api.fetchPublicShare).mockResolvedValue(fakeShare as never);
  });

  afterEach(async () => {
    await client.cancelQueries();
    client.clear();
    vi.clearAllMocks();
  });

  it("fetches public share data for a given slug", async () => {
    const { result } = renderHook(() => usePublicShare("my-slug"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(fakeShare);
    expect(api.fetchPublicShare).toHaveBeenCalledWith("my-slug");
  });

  it("does NOT fetch when slug is empty", async () => {
    renderHook(() => usePublicShare(""), { wrapper: makeWrapper(client) });

    await new Promise((r) => setTimeout(r, 50));
    expect(api.fetchPublicShare).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useShareAccess
// ---------------------------------------------------------------------------

describe("useShareAccess", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = makeFreshClient();
    vi.mocked(api.fetchPublicShare).mockResolvedValue({ id: "pub1", slug: "slug" } as never);
    vi.mocked(api.accessShare).mockResolvedValue({ id: "priv1", slug: "slug" } as never);
  });

  afterEach(async () => {
    await client.cancelQueries();
    client.clear();
    vi.clearAllMocks();
  });

  it("keeps the raw key out of the query key and exchanges it through POST", async () => {
    const { result } = renderHook(
      () => useShareAccess("slug", { accessKey: "raw-secret", attempt: 1 }),
      { wrapper: makeWrapper(client) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.accessShare).toHaveBeenCalledWith("slug", "raw-secret", undefined);
    const queryKey = client.getQueryCache().getAll()[0]?.queryKey ?? [];
    expect(queryKey.slice(0, 4)).toEqual([
      "shareAccess",
      "slug",
      "key",
      "anonymous",
    ]);
    expect(queryKey[4]).toMatch(/^[0-9a-f-]{36}$/);
    expect(queryKey[5]).toBe(1);
    expect(JSON.stringify(queryKey)).not.toContain("raw-secret");
  });

  it("sends the owner JWT alongside a key so a stale key cannot block owner fallback", async () => {
    const { result } = renderHook(
      () => useShareAccess("slug", {
        accessKey: "stale-secret",
        accessToken: "owner-jwt",
        attempt: 1,
      }),
      { wrapper: makeWrapper(client) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.accessShare).toHaveBeenCalledWith("slug", "stale-secret", "owner-jwt");
  });

  it("loads a public share without sending the signed-in owner's JWT", async () => {
    const { result } = renderHook(
      () => useShareAccess("slug", { accessToken: "owner-jwt", attempt: 0 }),
      { wrapper: makeWrapper(client) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchPublicShare).toHaveBeenCalledWith("slug");
    expect(api.accessShare).not.toHaveBeenCalled();
  });

  it("falls back to the scoped metadata grant or owner authorization when public metadata requires a key", async () => {
    vi.mocked(api.fetchPublicShare).mockRejectedValue(
      Object.assign(new Error("Access key required."), { code: "share_access_required" })
    );

    const { result } = renderHook(
      () => useShareAccess("slug", { accessToken: "owner-jwt", attempt: 0 }),
      { wrapper: makeWrapper(client) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.accessShare).toHaveBeenCalledWith("slug", undefined, "owner-jwt");
  });

  it("tries the scoped metadata grant for an anonymous reload after the fragment was scrubbed", async () => {
    vi.mocked(api.fetchPublicShare).mockRejectedValue(
      Object.assign(new Error("Access key required."), { code: "share_access_required" })
    );

    const { result } = renderHook(
      () => useShareAccess("slug", { attempt: 0 }),
      { wrapper: makeWrapper(client) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.accessShare).toHaveBeenCalledWith("slug", undefined, undefined);
  });

  it("uses a new opaque query identity on every mount so rotated keys cannot hit stale success", async () => {
    const first = renderHook(
      () => useShareAccess("slug", { accessKey: "key-a", attempt: 0 }),
      { wrapper: makeWrapper(client) }
    );
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const firstIdentity = client.getQueryCache().getAll()[0]?.queryKey[4];
    first.unmount();

    const second = renderHook(
      () => useShareAccess("slug", { accessKey: "key-b", attempt: 0 }),
      { wrapper: makeWrapper(client) }
    );
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    const secondIdentity = client.getQueryCache().getAll()[0]?.queryKey[4];

    expect(firstIdentity).not.toBe(secondIdentity);
    expect(api.accessShare).toHaveBeenNthCalledWith(1, "slug", "key-a", undefined);
    expect(api.accessShare).toHaveBeenNthCalledWith(2, "slug", "key-b", undefined);
  });

  it("isolates owner-mode metadata by stable user id without putting the JWT in the key", async () => {
    vi.mocked(api.fetchPublicShare).mockRejectedValue(
      Object.assign(new Error("Access key required."), { code: "share_access_required" })
    );
    const props = { viewerId: "user-a", accessToken: "jwt-a" };
    const { result, rerender } = renderHook(
      ({ viewerId, accessToken }) => useShareAccess("slug", {
        viewerId,
        accessToken,
        attempt: 0,
      }),
      { wrapper: makeWrapper(client), initialProps: props }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ viewerId: "user-b", accessToken: "jwt-b" });
    await waitFor(() => expect(api.accessShare).toHaveBeenCalledTimes(2));

    const keys = client.getQueryCache().getAll().map((query) => query.queryKey);
    expect(keys.some((key) => key[3] === "user-b")).toBe(true);
    expect(JSON.stringify(keys)).not.toContain("jwt-a");
    expect(JSON.stringify(keys)).not.toContain("jwt-b");
  });
});

// ---------------------------------------------------------------------------
// useUploadShare
// ---------------------------------------------------------------------------

describe("useUploadShare", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = makeFreshClient();
    vi.mocked(api.uploadShare).mockResolvedValue({
      share: { id: "new-share", slug: "new-slug" } as never,
      claimToken: "claim-tok",
      accessKey: null,
      message: "Uploaded",
    });
  });

  afterEach(async () => {
    await client.cancelQueries();
    client.clear();
    vi.clearAllMocks();
  });

  it("calls uploadShare api fn on mutate", async () => {
    const { result } = renderHook(() => useUploadShare(), {
      wrapper: makeWrapper(client),
    });

    const file = new File(["<h1>hi</h1>"], "index.html", {
      type: "text/html",
    });

    await act(async () => {
      await result.current.mutateAsync({
        file,
        title: "My Upload",
        visibility: "public_unlisted",
        accessToken: "tok",
        source: "agents",
      });
    });

    expect(api.uploadShare).toHaveBeenCalledWith(
      file,
      "My Upload",
      "public_unlisted",
      "tok",
      "agents"
    );
  });

  it("invalidates ['myShares'] on success", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useUploadShare(), {
      wrapper: makeWrapper(client),
    });

    const file = new File(["x"], "index.html", { type: "text/html" });

    await act(async () => {
      await result.current.mutateAsync({
        file,
        title: "T",
        visibility: "public_unlisted",
      });
    });

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["myShares"] })
    );
  });
});

describe("useRotateShareAccessKey", () => {
  it("clears cached access state for the rotated slug", async () => {
    const client = makeFreshClient();
    vi.mocked(api.rotateShareAccessKey).mockResolvedValue({
      share: { slug: "rotated-slug" } as never,
      accessKey: "new-key",
    });
    client.setQueryData(
      ["shareAccess", "rotated-slug", "key", "anonymous", "old-session", 0],
      { id: "stale" }
    );
    const { result } = renderHook(() => useRotateShareAccessKey(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ shareId: "share-1", accessToken: "owner-jwt" });
    });

    expect(api.rotateShareAccessKey).toHaveBeenCalledWith("share-1", "owner-jwt");
    expect(client.getQueriesData({ queryKey: ["shareAccess", "rotated-slug"] })).toEqual([]);
    client.clear();
  });
});

// ---------------------------------------------------------------------------
// useDeleteShare
// ---------------------------------------------------------------------------

describe("useDeleteShare", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = makeFreshClient();
    vi.mocked(api.deleteShare).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await client.cancelQueries();
    client.clear();
    vi.clearAllMocks();
  });

  it("calls deleteShare api fn on mutate", async () => {
    const { result } = renderHook(() => useDeleteShare(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: "share-1", accessToken: "tok" });
    });

    expect(api.deleteShare).toHaveBeenCalledWith("share-1", "tok");
  });

  it("invalidates ['myShares'] on success", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useDeleteShare(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: "s1", accessToken: "tok" });
    });

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["myShares"] })
    );
  });
});

// ---------------------------------------------------------------------------
// useClaimShare
// ---------------------------------------------------------------------------

describe("useClaimShare", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = makeFreshClient();
    vi.mocked(api.claimShare).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await client.cancelQueries();
    client.clear();
    vi.clearAllMocks();
  });

  it("calls claimShare api fn on mutate", async () => {
    const { result } = renderHook(() => useClaimShare(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        shareId: "s-99",
        claimToken: "claim",
        accessToken: "jwt",
      });
    });

    expect(api.claimShare).toHaveBeenCalledWith("s-99", "claim", "jwt");
  });

  it("invalidates ['myShares'] on success", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useClaimShare(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        shareId: "s-99",
        claimToken: "c",
        accessToken: "j",
      });
    });

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["myShares"] })
    );
  });
});

// ---------------------------------------------------------------------------
// useReportShare
// ---------------------------------------------------------------------------

describe("useReportShare", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = makeFreshClient();
    vi.mocked(api.reportShare).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await client.cancelQueries();
    client.clear();
    vi.clearAllMocks();
  });

  it("calls reportShare api fn on mutate", async () => {
    const { result } = renderHook(() => useReportShare(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        shareId: "s-42",
        reason: "phishing",
        details: "Looks bad",
        accessToken: "tok",
      });
    });

    expect(api.reportShare).toHaveBeenCalledWith(
      "s-42",
      "phishing",
      "Looks bad",
      "tok"
    );
  });

  it("completes without error when no accessToken provided", async () => {
    const { result } = renderHook(() => useReportShare(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      result.current.mutate({
        shareId: "s-42",
        reason: "malware",
        details: "",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.reportShare).toHaveBeenCalledWith("s-42", "malware", "", undefined);
  });
});
