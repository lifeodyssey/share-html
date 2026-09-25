import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  delete (window as Window & { dataLayer?: unknown }).dataLayer;
  delete (window as Window & { gtag?: unknown }).gtag;
  delete (window as unknown as Record<string, unknown>)["ga-disable-G-TEST12345"];
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "0" });
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  window.history.replaceState({}, "", "/");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.querySelectorAll('script[src*="googletagmanager"]').forEach((s) => s.remove()); });

test("a new visitor gets sanitized browser and Google analytics without a preference click", async () => {
  const a = await import("../../src/client/analytics");
  a.configureAnalytics({ analyticsEnabled: true, ga4MeasurementId: "G-TEST12345" });
  a.trackPage("/");
  expect(a.readAnalyticsConsent()).toBe("granted");
  expect(localStorage.getItem("sharehtml.analytics.consent")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(document.querySelector('script[src*="googletagmanager"]')).not.toBeNull();
  const layer = (window as unknown as { dataLayer: unknown[] }).dataLayer;
  expect(layer.map(entry => Array.from(entry as ArrayLike<unknown>)))
    .toContainEqual(["event", "page_view", expect.objectContaining({ page_location: window.location.origin + "/" })]);
});

test("an existing opt-out prevents session storage, browser events and Google loading", async () => {
  localStorage.setItem("sharehtml.analytics.consent", "denied");
  const a = await import("../../src/client/analytics");
  a.configureAnalytics({ analyticsEnabled: true, ga4MeasurementId: "G-TEST12345" });
  a.trackBrowserEvent("page_view");
  expect(fetch).not.toHaveBeenCalled();
  expect(a.uploadAnalyticsContext()).toBeNull();
  a.trackBrowserEvent("upload_started");
  expect(fetch).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
});

test.each(["doNotTrack", "globalPrivacyControl"])("%s overrides the default and explicit enablement", async (signal) => {
  Object.defineProperty(navigator, signal, { configurable: true, value: signal === "doNotTrack" ? "1" : true });
  const a = await import("../../src/client/analytics");
  a.configureAnalytics({ analyticsEnabled: true, ga4MeasurementId: "G-TEST12345" });
  a.trackPage("/");
  a.setAnalyticsConsent("granted");
  a.trackBrowserEvent("upload_started");
  expect(a.readAnalyticsConsent()).toBe("denied");
  expect(fetch).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
});

test("opting out still disables an initialized Google tag when saving the preference fails", async () => {
  const a = await import("../../src/client/analytics");
  a.configureAnalytics({ analyticsEnabled: true, ga4MeasurementId: "G-TEST12345" });
  a.trackPage("/");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  a.setAnalyticsConsent("denied");
  a.trackBrowserEvent("upload_started");
  expect(a.readAnalyticsConsent()).toBe("denied");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sessionStorage.length).toBe(0);
  expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST12345"]).toBe(true);
});

test("unreadable saved preferences do not enable analytics", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  const a = await import("../../src/client/analytics");
  a.configureAnalytics({ analyticsEnabled: true, ga4MeasurementId: "G-TEST12345" });
  a.trackPage("/");
  expect(fetch).not.toHaveBeenCalled();
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
});

test("attribution allowlist keeps only campaign tokens and external hostname, never secrets or referrer paths", async () => {
  const a = await import("../../src/client/analytics");
  expect(a.captureAcquisition("https://sharehtml.zhenjia.dev/?utm_source=ChatGPT&utm_medium=referral&utm_campaign=person%40example.com&claimToken=secret#key=secret", "https://chatgpt.com/c/private-conversation?token=secret"))
    .toEqual({ source: "chatgpt", medium: "referral", referrer_domain: "chatgpt.com" });
  expect(a.captureAcquisition("https://sharehtml.zhenjia.dev/?source=shared_preview", "https://sharehtml.zhenjia.dev/s/private-slug"))
    .toEqual({});
});

test("one consenting tab session links a later upload to the original external acquisition", async () => {
  const a = await import("../../src/client/analytics");
  window.history.replaceState({}, "", "/?utm_source=google&utm_medium=organic#key=secret");
  a.configureAnalytics({ analyticsEnabled: true });
  a.setAnalyticsConsent("granted");
  a.trackPage("/");
  const first = a.uploadAnalyticsContext();
  window.history.replaceState({}, "", "/examples");
  a.trackPage("/examples");
  expect(a.uploadAnalyticsContext()).toEqual(first);
  const payloads = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  expect(payloads[0].session_id).toBe(payloads[1].session_id);
  expect(payloads[1].acquisition.source).toBe("google");
  expect(JSON.stringify(payloads)).not.toContain("secret");
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
});

test("share route telemetry uses a template and never loads Google or forwards the access key", async () => {
  const a = await import("../../src/client/analytics");
  window.history.replaceState({}, "", "/s/a-private-slug?accessKey=secret#key=other-secret");
  a.configureAnalytics({ analyticsEnabled: true, ga4MeasurementId: "G-TEST12345" });
  a.trackPage(window.location.pathname);
  const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
  expect(payload.route).toBe("/s/:slug");
  expect(JSON.stringify(payload)).not.toMatch(/private-slug|secret/);
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
});

test("mutable session storage cannot inject extra fields into upload telemetry", async () => {
  const a = await import("../../src/client/analytics");
  sessionStorage.setItem("sharehtml.analytics.session.v1", JSON.stringify({
    session_id: crypto.randomUUID(), token: "secret", acquisition: { source: "google", password: "secret", campaign: "person@example.com", referrer_domain: "example.com/private?token=secret" },
  }));
  a.configureAnalytics({ analyticsEnabled: true });
  a.setAnalyticsConsent("granted");
  expect(a.uploadAnalyticsContext()?.acquisition).toEqual({ source: "google" });
});

test("revoking consent clears the session and blocks future events and upload attribution", async () => {
  const a = await import("../../src/client/analytics");
  a.configureAnalytics({ analyticsEnabled: true });
  a.setAnalyticsConsent("granted");
  a.trackPage("/");
  expect(fetch).toHaveBeenCalledTimes(1);
  a.setAnalyticsConsent("denied");
  a.trackBrowserEvent("upload_started");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(a.uploadAnalyticsContext()).toBeNull();
  expect(sessionStorage.length).toBe(0);
});

test("same route is not double-counted by React effect replay", async () => {
  const a = await import("../../src/client/analytics");
  a.configureAnalytics({ analyticsEnabled: true });
  a.setAnalyticsConsent("granted");
  a.trackPage("/"); a.trackPage("/");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("Google manual event parameters contain only normalized paths and safe attribution", async () => {
  const a = await import("../../src/client/analytics");
  window.history.replaceState({}, "", "/?utm_source=chatgpt&access_token=secret#key=secret");
  a.configureAnalytics({ analyticsEnabled: true, ga4MeasurementId: "G-TEST12345" });
  a.setAnalyticsConsent("granted");
  a.trackPage("/");
  const layer = (window as unknown as { dataLayer: unknown[] }).dataLayer;
  expect(JSON.stringify(layer)).not.toContain("secret");
  expect(JSON.stringify(layer)).toContain("send_page_view");
  const gaConfig = layer.map(entry => Array.from(entry as ArrayLike<unknown>))
    .find(entry => entry[0] === "config");
  expect(gaConfig?.[2]).toMatchObject({ cookie_domain: window.location.hostname, cookie_prefix: "sharehtml" });
  expect(document.querySelector('script[src*="googletagmanager"]')?.getAttribute("referrerpolicy")).toBe("no-referrer");
});

test.each(["active", "needs_review"])("GA creation conversion requires a usable upload: %s", async (status) => {
  const a = await import("../../src/client/analytics");
  const { uploadShare } = await import("../../src/client/api");
  a.configureAnalytics({ analyticsEnabled: true, ga4MeasurementId: "G-TEST12345" });
  a.setAnalyticsConsent("granted");
  vi.mocked(fetch).mockImplementation(async (url) => url === "/api/shares"
    ? new Response(JSON.stringify({ share: { lifecycle_status: status } }), { status: status === "active" ? 201 : 202 })
    : new Response(null, { status: 204 }));
  await uploadShare(new File(["<p>Example</p>"], "index.html"), "Example", "public_unlisted");
  const layer = (window as unknown as { dataLayer: unknown[] }).dataLayer;
  const conversions = layer.map(entry => Array.from(entry as ArrayLike<unknown>))
    .filter(entry => entry[0] === "event" && entry[1] === "share_created");
  expect(conversions).toHaveLength(status === "active" ? 1 : 0);
});
