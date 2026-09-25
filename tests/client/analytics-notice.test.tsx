import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-router", () => ({ useRouterState: () => "/" }));
vi.mock("../../src/client/queries", () => ({
  useConfig: () => ({ data: { analyticsEnabled: true, ga4MeasurementId: "G-TEST12345" } }),
}));
vi.mock("../../src/client/webmcp", () => ({ reportWebMcpState: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "0" });
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  delete (window as Window & { dataLayer?: unknown }).dataLayer;
  delete (window as Window & { gtag?: unknown }).gtag;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.querySelectorAll('script[src*="googletagmanager"]').forEach(script => script.remove());
});

test("a visitor is measured by default and can turn analytics off and back on through the notice", async () => {
  const { AnalyticsNotice } = await import("../../src/client/AnalyticsNotice");
  const user = userEvent.setup();
  render(<AnalyticsNotice />);
  expect(fetch).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Analytics: on · Preferences" }));
  expect(screen.getByText(/including Google Analytics/).textContent).toContain("on by default");
  await user.click(screen.getByRole("button", { name: "Turn off analytics" }));
  expect(localStorage.getItem("sharehtml.analytics.consent")).toBe("denied");
  expect(sessionStorage.length).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST12345"]).toBe(true);
  await user.click(screen.getByRole("button", { name: "Analytics: off · Preferences" }));
  await user.click(screen.getByRole("button", { name: "Turn on analytics" }));
  expect(localStorage.getItem("sharehtml.analytics.consent")).toBe("granted");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("an existing opt-out is visible and opening preferences does not start collection", async () => {
  localStorage.setItem("sharehtml.analytics.consent", "denied");
  const { AnalyticsNotice } = await import("../../src/client/AnalyticsNotice");
  render(<AnalyticsNotice />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Analytics: off · Preferences" }));
  expect(fetch).not.toHaveBeenCalled();
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
});

test("a browser privacy signal keeps collection off and disables the enable button", async () => {
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
  const { AnalyticsNotice } = await import("../../src/client/AnalyticsNotice");
  render(<AnalyticsNotice />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Analytics: off · Preferences" }));
  expect((screen.getByRole("button", { name: "Turn on analytics" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
