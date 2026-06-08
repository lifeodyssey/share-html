/**
 * Component-level tests for the TanStack Query + Router migration.
 *
 * Covers:
 *  - UploadPanel: mutation fires, result rendered, error path
 *  - Dashboard: renders shares from useMyShares, delete/claim mutations
 *  - SharePage: resolves slug → query, renders share data, report mutation
 *
 * Strategy
 * --------
 * - vi.mock api so no real fetch calls are made.
 * - Each test creates a fresh QueryClient (retry/gc off).
 * - Components that use TanStack Router hooks (useParams, useNavigate, Link)
 *   are wrapped in a RouterProvider backed by createMemoryHistory.
 * - SessionContext is provided directly so we can control session state.
 * - cleanup() is called after each test to clear the DOM.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the api module (no network)
// ---------------------------------------------------------------------------
vi.mock("../../src/client/api.ts", () => ({
  fetchConfig: vi.fn(),
  listShares: vi.fn(),
  fetchPublicShare: vi.fn(),
  uploadShare: vi.fn(),
  deleteShare: vi.fn(),
  claimShare: vi.fn(),
  reportShare: vi.fn(),
}));

import * as api from "../../src/client/api.ts";
import { HomePage, SharePage } from "../../src/client/main";
import { SessionContext, type SessionCtxValue } from "../../src/client/session";

// ---------------------------------------------------------------------------
// Auto-cleanup after every test
// ---------------------------------------------------------------------------
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

/**
 * Renders a component inside a fresh TanStack Router + QueryClient +
 * SessionContext, returning the @testing-library render result.
 */
function renderWithProviders(
  Component: React.ComponentType,
  {
    sessionValue,
    initialPath,
    routePath,
  }: {
    sessionValue: SessionCtxValue;
    initialPath: string;
    routePath: string;
  }
) {
  const client = makeFreshClient();
  const history = createMemoryHistory({ initialEntries: [initialPath] });

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const testRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: routePath,
    component: Component,
  });
  const routeTree = rootRoute.addChildren([testRoute]);
  const router = createRouter({ routeTree, history });

  return render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={sessionValue}>
        <RouterProvider router={router} />
      </SessionContext.Provider>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Session fixtures
// ---------------------------------------------------------------------------

const noSession: SessionCtxValue = { session: null, supabase: null };

const withSession: SessionCtxValue = {
  session: {
    access_token: "tok-xyz",
    user: { email: "user@example.com", id: "uid-1" },
  } as never,
  supabase: null,
};

// ---------------------------------------------------------------------------
// Share fixture
// ---------------------------------------------------------------------------

const fakeShare = {
  id: "share-1",
  slug: "my-slug",
  title: "My HTML Page",
  lifecycle_status: "active",
  risk_score: 1,
  risk_reasons: [],
  size_bytes: 2048,
  share_url: "https://example.com/s/my-slug",
  preview_url: "https://cdn.example.com/preview/my-slug",
  expires_at: null,
  owner_id: null,
};

// ---------------------------------------------------------------------------
// UploadPanel (rendered inside HomePage)
// ---------------------------------------------------------------------------

describe("UploadPanel (via HomePage)", () => {
  it("shows validation error when submitted without a file", async () => {
    // listShares will be called by Dashboard (signed-in session) – not needed here
    renderWithProviders(HomePage, {
      sessionValue: noSession,
      initialPath: "/",
      routePath: "/",
    });

    const user = userEvent.setup();
    const submitBtn = await screen.findByRole("button", { name: /create share/i });
    await user.click(submitBtn);

    expect(await screen.findByText(/choose an html file first/i)).toBeDefined();
  });

  it("calls uploadShare mutation on submit and renders result", async () => {
    vi.mocked(api.uploadShare).mockResolvedValue({
      share: fakeShare as never,
      claimToken: "claim-abc",
      message: "Uploaded",
    });

    renderWithProviders(HomePage, {
      sessionValue: noSession,
      initialPath: "/",
      routePath: "/",
    });

    const user = userEvent.setup();
    const fileInput = await screen.findByLabelText(/choose an html file/i);
    const file = new File(["<h1>Hello</h1>"], "index.html", { type: "text/html" });
    await user.upload(fileInput, file);

    // The upload panel form's submit button
    const form = screen.getByRole("form", { name: /upload an html file/i });
    const submitBtn = form.querySelector("button.button.primary")!;
    await user.click(submitBtn);

    expect(await screen.findByText(/your share is live/i)).toBeDefined();
    expect(await screen.findByText("My HTML Page")).toBeDefined();
    expect(api.uploadShare).toHaveBeenCalledWith(file, "", undefined);
  });

  it("shows error message when uploadShare rejects", async () => {
    vi.mocked(api.uploadShare).mockRejectedValue(new Error("Server error"));

    renderWithProviders(HomePage, {
      sessionValue: noSession,
      initialPath: "/",
      routePath: "/",
    });

    const user = userEvent.setup();
    const fileInput = await screen.findByLabelText(/choose an html file/i);
    const file = new File(["<h1>Bad</h1>"], "index.html", { type: "text/html" });
    await user.upload(fileInput, file);

    const form = screen.getByRole("form", { name: /upload an html file/i });
    const submitBtn = form.querySelector("button.button.primary")!;
    await user.click(submitBtn);

    expect(await screen.findByText(/server error/i)).toBeDefined();
  });

  it("passes access token when session is present", async () => {
    vi.mocked(api.uploadShare).mockResolvedValue({
      share: fakeShare as never,
      claimToken: null,
      message: "ok",
    });
    // Dashboard will also fire listShares in this test
    vi.mocked(api.listShares).mockResolvedValue([]);

    renderWithProviders(HomePage, {
      sessionValue: withSession,
      initialPath: "/",
      routePath: "/",
    });

    const user = userEvent.setup();
    const fileInput = await screen.findByLabelText(/choose an html file/i);
    const file = new File(["x"], "index.html", { type: "text/html" });
    await user.upload(fileInput, file);

    const form = screen.getByRole("form", { name: /upload an html file/i });
    const submitBtn = form.querySelector("button.button.primary")!;
    await user.click(submitBtn);

    await waitFor(() =>
      expect(api.uploadShare).toHaveBeenCalledWith(file, "", "tok-xyz")
    );
  });
});

// ---------------------------------------------------------------------------
// Dashboard (rendered inside HomePage)
// ---------------------------------------------------------------------------

describe("Dashboard (via HomePage)", () => {
  it("shows sign-in prompt when session is absent", async () => {
    renderWithProviders(HomePage, {
      sessionValue: noSession,
      initialPath: "/",
      routePath: "/",
    });

    expect(
      await screen.findByText(/sign in to keep shares/i)
    ).toBeDefined();
    expect(api.listShares).not.toHaveBeenCalled();
  });

  it("renders shares from useMyShares when signed in", async () => {
    vi.mocked(api.listShares).mockResolvedValue([
      { ...fakeShare, id: "s1", slug: "slug-1", title: "First Share" } as never,
      { ...fakeShare, id: "s2", slug: "slug-2", title: "Second Share" } as never,
    ]);

    renderWithProviders(HomePage, {
      sessionValue: withSession,
      initialPath: "/",
      routePath: "/",
    });

    expect(await screen.findByText("First Share")).toBeDefined();
    expect(await screen.findByText("Second Share")).toBeDefined();
    expect(api.listShares).toHaveBeenCalledWith("tok-xyz");
  });

  it("shows 'No shares yet' when list is empty", async () => {
    vi.mocked(api.listShares).mockResolvedValue([]);

    renderWithProviders(HomePage, {
      sessionValue: withSession,
      initialPath: "/",
      routePath: "/",
    });

    expect(await screen.findByText(/no shares yet/i)).toBeDefined();
  });

  it("calls deleteShare mutation when Delete button is clicked", async () => {
    vi.mocked(api.listShares).mockResolvedValue([
      { ...fakeShare, id: "del-1", slug: "del-slug", title: "To Delete" } as never,
    ]);
    vi.mocked(api.deleteShare).mockResolvedValue(undefined);

    renderWithProviders(HomePage, {
      sessionValue: withSession,
      initialPath: "/",
      routePath: "/",
    });

    const user = userEvent.setup();
    const deleteBtn = await screen.findByRole("button", { name: /delete/i });
    await user.click(deleteBtn);

    await waitFor(() =>
      expect(api.deleteShare).toHaveBeenCalledWith("del-1", "tok-xyz")
    );
    expect(await screen.findByText(/deleted\./i)).toBeDefined();
  });

  it("calls claimShare mutation when Claim form is submitted", async () => {
    vi.mocked(api.listShares).mockResolvedValue([]);
    vi.mocked(api.claimShare).mockResolvedValue(undefined);

    renderWithProviders(HomePage, {
      sessionValue: withSession,
      initialPath: "/",
      routePath: "/",
    });

    const user = userEvent.setup();
    const shareIdInput = await screen.findByPlaceholderText(/anonymous share id/i);
    const claimTokenInput = screen.getByPlaceholderText(/claim token/i);

    await user.type(shareIdInput, "share-id-123");
    await user.type(claimTokenInput, "tok-claim");

    // Click the Claim button (inside the claim-form, distinct from Delete)
    const claimBtn = screen.getByRole("button", { name: /^claim$/i });
    await user.click(claimBtn);

    await waitFor(() =>
      expect(api.claimShare).toHaveBeenCalledWith("share-id-123", "tok-claim", "tok-xyz")
    );
    expect(await screen.findByText(/claimed\./i)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SharePage – resolves slug → usePublicShare, renders data, report mutation
// ---------------------------------------------------------------------------

describe("SharePage", () => {
  it("shows loading state initially", async () => {
    // Never-resolving promise keeps loading indefinitely
    vi.mocked(api.fetchPublicShare).mockReturnValue(new Promise(() => {}));

    renderWithProviders(SharePage, {
      sessionValue: noSession,
      initialPath: "/s/my-slug",
      routePath: "/s/$slug",
    });

    expect(await screen.findByText(/loading share/i)).toBeDefined();
  });

  it("renders share data after query resolves", async () => {
    vi.mocked(api.fetchPublicShare).mockResolvedValue(fakeShare as never);

    renderWithProviders(SharePage, {
      sessionValue: noSession,
      initialPath: "/s/my-slug",
      routePath: "/s/$slug",
    });

    expect(await screen.findByText("My HTML Page")).toBeDefined();
    expect(screen.getByText(/public unlisted share/i)).toBeDefined();
    expect(api.fetchPublicShare).toHaveBeenCalledWith("my-slug");
  });

  it("shows error when share is not found", async () => {
    vi.mocked(api.fetchPublicShare).mockRejectedValue(new Error("Share not found"));

    renderWithProviders(SharePage, {
      sessionValue: noSession,
      initialPath: "/s/bad-slug",
      routePath: "/s/$slug",
    });

    expect(await screen.findByText(/share not found/i)).toBeDefined();
  });

  it("renders preview iframe for active shares", async () => {
    vi.mocked(api.fetchPublicShare).mockResolvedValue({
      ...fakeShare,
      lifecycle_status: "active",
    } as never);

    renderWithProviders(SharePage, {
      sessionValue: noSession,
      initialPath: "/s/my-slug",
      routePath: "/s/$slug",
    });

    // Wait for share to load; iframe title matches the share title
    await screen.findByText("My HTML Page");
    const iframe = document.querySelector("iframe.preview-frame") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.title).toBe("My HTML Page");
    expect(iframe.getAttribute("src")).toContain("preview/my-slug");
  });

  it("shows SystemNotice instead of iframe for non-active shares", async () => {
    vi.mocked(api.fetchPublicShare).mockResolvedValue({
      ...fakeShare,
      lifecycle_status: "removed",
    } as never);

    renderWithProviders(SharePage, {
      sessionValue: noSession,
      initialPath: "/s/my-slug",
      routePath: "/s/$slug",
    });

    expect(await screen.findByText(/preview unavailable/i)).toBeDefined();
    expect(screen.queryByTitle(/shared html preview/i)).toBeNull();
  });

  it("submits report mutation on report form submit", async () => {
    vi.mocked(api.fetchPublicShare).mockResolvedValue(fakeShare as never);
    vi.mocked(api.reportShare).mockResolvedValue(undefined);

    renderWithProviders(SharePage, {
      sessionValue: noSession,
      initialPath: "/s/my-slug",
      routePath: "/s/$slug",
    });

    const user = userEvent.setup();
    // Wait for share to load
    await screen.findByText("My HTML Page");

    const detailsInput = screen.getByPlaceholderText(/optional details/i);
    await user.type(detailsInput, "looks suspicious");

    const reportBtn = screen.getByRole("button", { name: /^report$/i });
    await user.click(reportBtn);

    await waitFor(() =>
      expect(api.reportShare).toHaveBeenCalledWith(
        "share-1",
        "phishing",
        "looks suspicious",
        undefined
      )
    );
    expect(await screen.findByText(/report received/i)).toBeDefined();
  });

  it("passes access token to report mutation when signed in", async () => {
    vi.mocked(api.fetchPublicShare).mockResolvedValue(fakeShare as never);
    vi.mocked(api.reportShare).mockResolvedValue(undefined);

    renderWithProviders(SharePage, {
      sessionValue: withSession,
      initialPath: "/s/my-slug",
      routePath: "/s/$slug",
    });

    const user = userEvent.setup();
    await screen.findByText("My HTML Page");

    await user.click(screen.getByRole("button", { name: /^report$/i }));

    await waitFor(() =>
      expect(api.reportShare).toHaveBeenCalledWith(
        "share-1",
        "phishing",
        "",
        "tok-xyz"
      )
    );
  });
});
