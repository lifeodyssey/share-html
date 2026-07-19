/**
 * Code-based TanStack Router v1 route tree.
 *
 * Route structure:
 *   /          → HomePage  (rendered inside root layout)
 *   /s/$slug   → SharePage (rendered inside root layout)
 *   First-party acquisition pages are explicit static routes so the Worker can
 *   serve matching crawlable HTML instead of an unknown-route SPA fallback.
 *
 * The root route renders the persistent <Header> (from session.tsx) and an
 * <Outlet> for the matched child route.  Navigation happens through <Link>
 * and the `navigate` helper returned by `useNavigate()`.
 *
 * Import graph (no circular dependency):
 *   session.tsx  ←  router.tsx  ←  main.tsx
 */
import React from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";

import { Header } from "./session";

// Lazy imports from main.tsx are NOT done here to avoid circular deps.
// Instead, the route components are defined in main.tsx and passed in via
// the routeTree — see the bottom of main.tsx where these routes are wired.
// We import them directly because they are plain React components and ESM
// handles the cycle safely (both files are fully evaluated before rendering).
import { HomePage, MarketingPageView, SharePage } from "./main";

// ---------------------------------------------------------------------------
// Root route – always-on layout
// ---------------------------------------------------------------------------
const rootRoute = createRootRoute({
  component: () => (
    <main className="app-shell">
      <Header />
      <Outlet />
    </main>
  ),
});

// ---------------------------------------------------------------------------
// Index route  /
// ---------------------------------------------------------------------------
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

// ---------------------------------------------------------------------------
// Share route  /s/$slug
// ---------------------------------------------------------------------------
const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$slug",
  component: SharePage,
});

const htmlPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/html-preview",
  component: () => <MarketingPageView path="/html-preview" />,
});

const privateHtmlSharingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/private-html-sharing",
  component: () => <MarketingPageView path="/private-html-sharing" />,
});

const examplesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/examples",
  component: () => <MarketingPageView path="/examples" />,
});

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: () => <MarketingPageView path="/agents" />,
});

// ---------------------------------------------------------------------------
// Assemble the tree and create the router
// ---------------------------------------------------------------------------
const routeTree = rootRoute.addChildren([
  indexRoute,
  shareRoute,
  htmlPreviewRoute,
  privateHtmlSharingRoute,
  examplesRoute,
  agentsRoute,
]);

export const router = createRouter({ routeTree });

// Mandatory ambient declaration so typed <Link> / useNavigate work everywhere
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
