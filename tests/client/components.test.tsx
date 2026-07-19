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
import { act, render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the api module (no network)
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

import * as api from "../../src/client/api.ts";
import { HomePage, MarketingPageView, SharePage } from "../../src/client/main";
import { SessionContext, type SessionCtxValue } from "../../src/client/session";
import type { PublicShare } from "../../src/shared/types";

// ---------------------------------------------------------------------------
// Auto-cleanup after every test
// ---------------------------------------------------------------------------
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  document.head.innerHTML = "";
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

  const rendered = render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={sessionValue}>
        <RouterProvider router={router} />
      </SessionContext.Provider>
    </QueryClientProvider>
  );
  return { ...rendered, router };
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
  moderation_status: "clean",
  visibility: "public_unlisted",
  risk_score: 1,
  risk_reasons: [],
  size_bytes: 2048,
  share_url: "https://example.com/s/my-slug",
  preview_url: "https://cdn.example.com/preview/my-slug",
  expires_at: null,
  created_at: "2026-07-19T00:00:00.000Z",
} satisfies PublicShare;

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
      accessKey: null,
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
    expect(api.uploadShare).toHaveBeenCalledWith(
      file,
      "",
      "public_unlisted",
      undefined,
      "direct"
    );
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

  it("preloads an allowlisted example and preserves its acquisition source", async () => {
    window.history.replaceState({}, "", "/?example=status-dashboard&source=examples");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><html><h1>Example</h1></html>", {
        headers: { "content-type": "text/html" },
      })
    );
    vi.mocked(api.uploadShare).mockResolvedValue({
      share: fakeShare as never,
      claimToken: "claim-example",
      accessKey: null,
      message: "Uploaded",
    });

    renderWithProviders(HomePage, {
      sessionValue: noSession,
      initialPath: "/",
      routePath: "/",
    });

    expect(await screen.findByText(/status dashboard is ready to share/i)).toBeDefined();
    const form = screen.getByRole("form", { name: /upload an html file/i });
    await userEvent.setup().click(form.querySelector("button.button.primary")!);

    await waitFor(() => expect(api.uploadShare).toHaveBeenCalled());
    const [file, title, visibility, token, source] = vi.mocked(api.uploadShare).mock.calls[0];
    expect(file.name).toBe("status-dashboard.html");
    expect(title).toBe("Status dashboard");
    expect(visibility).toBe("public_unlisted");
    expect(token).toBeUndefined();
    expect(source).toBe("examples");
    fetchSpy.mockRestore();
  });

  it("never lets a slow example preload replace a file or title chosen by the user", async () => {
    window.history.replaceState({}, "", "/?example=status-dashboard&source=examples");
    let resolveFetch!: (response: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    );
    vi.mocked(api.uploadShare).mockResolvedValue({
      share: fakeShare as never,
      claimToken: "claim-user-file",
      accessKey: null,
      message: "Uploaded",
    });

    renderWithProviders(HomePage, {
      sessionValue: noSession,
      initialPath: "/",
      routePath: "/",
    });

    const user = userEvent.setup();
    const chosenFile = new File(["<h1>User file</h1>"], "chosen.html", { type: "text/html" });
    await user.type(await screen.findByRole("textbox", { name: /title/i }), "User title");
    await user.upload(await screen.findByLabelText(/choose an html file/i), chosenFile);

    await act(async () => {
      resolveFetch(new Response("<h1>Late example</h1>", {
        headers: { "content-type": "text/html" },
      }));
    });

    const form = screen.getByRole("form", { name: /upload an html file/i });
    await user.click(form.querySelector("button.button.primary")!);

    await waitFor(() => expect(api.uploadShare).toHaveBeenCalled());
    expect(api.uploadShare).toHaveBeenCalledWith(
      chosenFile,
      "User title",
      "public_unlisted",
      undefined,
      "examples"
    );
    fetchSpy.mockRestore();
  });

  it("preserves a validated acquisition source through the OTP redirect", async () => {
    window.history.replaceState({}, "", "/?source=shared_preview&visibility=private_link");
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const sessionValue: SessionCtxValue = {
      session: null,
      supabase: { auth: { signInWithOtp } } as never,
    };

    renderWithProviders(HomePage, {
      sessionValue,
      initialPath: "/",
      routePath: "/",
    });

    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText("you@example.com"), "person@example.com");
    await user.click(screen.getByRole("button", { name: /send link/i }));

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
    const redirect = new URL(signInWithOtp.mock.calls[0][0].options.emailRedirectTo);
    expect(redirect.origin).toBe(window.location.origin);
    expect(redirect.pathname).toBe("/");
    expect(redirect.searchParams.get("source")).toBe("shared_preview");
    expect(redirect.searchParams.get("visibility")).toBe("private_link");
  });

  it("passes access token when session is present", async () => {
    vi.mocked(api.uploadShare).mockResolvedValue({
      share: fakeShare as never,
      claimToken: null,
      accessKey: null,
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
      expect(api.uploadShare).toHaveBeenCalledWith(
        file,
        "",
        "public_unlisted",
        "tok-xyz",
        "direct"
      )
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
  it("exchanges a fragment key and removes it from the address bar after success", async () => {
    const accessKey = "A".repeat(43);
    window.history.replaceState({}, "", `/s/my-slug#key=${accessKey}`);
    vi.mocked(api.accessShare).mockResolvedValue({
      ...fakeShare,
      visibility: "private_link",
      preview_url: "https://example.com/v/my-slug/",
    } as never);

    renderWithProviders(SharePage, {
      sessionValue: noSession,
      initialPath: "/s/my-slug",
      routePath: "/s/$slug",
    });

    expect(await screen.findByText(/private access-key share/i)).toBeDefined();
    expect(api.accessShare).toHaveBeenCalledWith("my-slug", accessKey, undefined);
    await waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("keeps owner authorization available when the URL contains a stale key", async () => {
    const staleKey = "B".repeat(43);
    window.history.replaceState({}, "", `/s/my-slug#key=${staleKey}`);
    vi.mocked(api.accessShare).mockResolvedValue({
      ...fakeShare,
      visibility: "private_link",
      preview_url: "https://example.com/v/my-slug/",
    } as never);

    renderWithProviders(SharePage, {
      sessionValue: withSession,
      initialPath: "/s/my-slug",
      routePath: "/s/$slug",
    });

    expect(await screen.findByText(/private access-key share/i)).toBeDefined();
    expect(api.accessShare).toHaveBeenCalledWith("my-slug", staleKey, "tok-xyz");
  });

  it("exchanges a replacement key when the hash changes on the same slug", async () => {
    const keyA = "A".repeat(43);
    const keyB = "B".repeat(43);
    window.history.replaceState({}, "", `/s/my-slug#key=${keyA}`);
    vi.mocked(api.accessShare).mockResolvedValue({
      ...fakeShare,
      visibility: "private_link",
      preview_url: "https://example.com/v/my-slug/",
    } as never);

    renderWithProviders(SharePage, {
      sessionValue: noSession,
      initialPath: "/s/my-slug",
      routePath: "/s/$slug",
    });
    expect(await screen.findByText(/private access-key share/i)).toBeDefined();
    expect(api.accessShare).toHaveBeenCalledWith("my-slug", keyA, undefined);

    window.history.replaceState({}, "", `/s/my-slug#key=${keyB}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    await waitFor(() => {
      expect(api.accessShare).toHaveBeenCalledWith("my-slug", keyB, undefined);
    });
  });

  it("never sends one slug's key while a reused route component switches slugs", async () => {
    const keyA = "A".repeat(43);
    const keyB = "B".repeat(43);
    window.history.replaceState({}, "", `/s/slug-a#key=${keyA}`);
    vi.mocked(api.accessShare).mockResolvedValue({
      ...fakeShare,
      visibility: "private_link",
      preview_url: "https://example.com/v/current/",
    } as never);

    const { router } = renderWithProviders(SharePage, {
      sessionValue: noSession,
      initialPath: "/s/slug-a",
      routePath: "/s/$slug",
    });
    await waitFor(() => {
      expect(api.accessShare).toHaveBeenCalledWith("slug-a", keyA, undefined);
    });
    window.history.replaceState({}, "", `/s/slug-b#key=${keyB}`);
    await act(async () => {
      await router.navigate({ to: "/s/$slug", params: { slug: "slug-b" } });
    });
    await waitFor(() => {
      expect(api.accessShare).toHaveBeenCalledWith("slug-b", keyB, undefined);
    });

    expect(api.accessShare).not.toHaveBeenCalledWith("slug-b", keyA, undefined);
  });

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
    const referral = screen.getByRole("link", { name: /share your html/i });
    expect(referral.getAttribute("href")).toBe("/?source=shared_preview");
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

describe("MarketingPageView", () => {
  it("renders an agent quickstart with the live MCP endpoint and upload CTA", () => {
    render(<MarketingPageView path="/agents" />);

    expect(screen.getByRole("heading", { name: /give an agent html/i })).toBeDefined();
    expect(screen.getByText("https://sharehtml.zhenjia.dev/mcp")).toBeDefined();
    expect(screen.getByRole("link", { name: /upload html/i }).getAttribute("href"))
      .toBe("/?source=agents");
  });

  it("keeps title, canonical, robots, and structured data in sync across SPA page changes", async () => {
    render(<MarketingPageView path="/agents" />);

    await waitFor(() => expect(document.title).toBe("Share HTML for AI Agents — MCP, OpenAPI, A2A, and HTTP"));
    expect(document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href)
      .toBe("https://sharehtml.zhenjia.dev/agents");
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content)
      .toBe("index, follow, max-image-preview:large");

    cleanup();
    renderWithProviders(HomePage, {
      sessionValue: noSession,
      initialPath: "/",
      routePath: "/",
    });

    await waitFor(() => expect(document.title).toBe("Share HTML — Upload and Share Sandboxed HTML Previews"));
    expect(document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href)
      .toBe("https://sharehtml.zhenjia.dev/");
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content)
      .toBe("index, follow, max-image-preview:large");
    expect(document.head.querySelector('script[type="application/ld+json"]')?.textContent)
      .toContain('"@type":"WebApplication"');
  });
});
