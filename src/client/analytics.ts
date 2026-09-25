type Acquisition = { source?: string; medium?: string; campaign?: string; referrer_domain?: string };
type Config = { analyticsEnabled?: boolean; ga4MeasurementId?: string };
export type BrowserEvent = "page_view" | "upload_started" | "upload_failed" | "share_link_copied";
export type Consent = "granted" | "denied";
type Context = { session_id: string; acquisition: Acquisition };

const CONSENT_KEY = "sharehtml.analytics.consent";
const CONTEXT_KEY = "sharehtml.analytics.session.v1";
const TOKEN = /^[a-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let config: Config = {};
let context: Context | null = null;
let configuredGa: string | null = null;
let lastPage: string | null = null;
let inMemoryConsent: Consent | null = null;

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

export function privacySignal(): boolean {
  return typeof navigator !== "undefined" && (navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true);
}

export function readAnalyticsConsent(): Consent {
  if (typeof window === "undefined" || privacySignal()) return "denied";
  if (inMemoryConsent) return inMemoryConsent;
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : "granted";
  } catch { return "denied"; }
}

export function setAnalyticsConsent(consent: Consent): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, consent);
    inMemoryConsent = null;
  } catch {
    // A failed preference write must not prevent opting out in this page.
    inMemoryConsent = consent;
  }
  if (consent === "denied") {
    context = null;
    lastPage = null;
    try { window.sessionStorage.removeItem(CONTEXT_KEY); } catch { /* Storage can be unavailable. */ }
    if (configuredGa) {
      (window as unknown as Record<string, unknown>)["ga-disable-" + configuredGa] = true;
      (window as AnalyticsWindow).gtag?.("consent", "update", { analytics_storage: "denied" });
    }
  }
}

export function configureAnalytics(value: Config): void { config = value; }

export function analyticsRoute(path: string): string | null {
  if (["/", "/html-preview", "/private-html-sharing", "/examples", "/agents"].includes(path)) return path;
  if (/^\/s\/[^/]+\/?$/.test(path)) return "/s/:slug";
  return null;
}

export function captureAcquisition(href: string, referrer: string): Acquisition {
  const result: Acquisition = {};
  try {
    const url = new URL(href);
    for (const [param, field] of [["utm_source", "source"], ["utm_medium", "medium"], ["utm_campaign", "campaign"]] as const) {
      const value = url.searchParams.get(param)?.toLowerCase();
      if (value && TOKEN.test(value)) result[field] = value;
    }
    if (referrer) {
      const from = new URL(referrer);
      if (["http:", "https:"].includes(from.protocol) && from.hostname !== url.hostname &&
        /^[a-z0-9.-]{1,253}$/.test(from.hostname) && !from.username && !from.password) {
        result.referrer_domain = from.hostname;
      }
    }
  } catch { /* Malformed referrers do not prevent an upload. */ }
  return result;
}

export function uploadAnalyticsContext(): Context | null {
  if (!config.analyticsEnabled || readAnalyticsConsent() !== "granted") return null;
  if (context) return context;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(CONTEXT_KEY) ?? "null") as Context | null;
    if (saved && UUID.test(saved.session_id) && typeof saved.acquisition === "object" && saved.acquisition !== null) {
      // Rebuild through the same allowlist instead of forwarding mutable storage.
      const url = new URL(window.location.origin);
      for (const field of ["source", "medium", "campaign"] as const) {
        const value = saved.acquisition[field];
        if (typeof value === "string" && TOKEN.test(value)) url.searchParams.set("utm_" + field, value);
      }
      const domain = saved.acquisition.referrer_domain;
      context = { session_id: saved.session_id, acquisition: captureAcquisition(url.href,
        typeof domain === "string" && /^[a-z0-9.-]{1,253}$/.test(domain) ? "https://" + domain : "") };
      return context;
    }
  } catch { /* Fall back to an in-memory session if storage is disabled. */ }
  if (!globalThis.crypto?.randomUUID) return null;
  context = { session_id: crypto.randomUUID(), acquisition: captureAcquisition(window.location.href, document.referrer) };
  try { window.sessionStorage.setItem(CONTEXT_KEY, JSON.stringify(context)); } catch { /* Optional persistence. */ }
  return context;
}

export function trackBrowserEvent(event: BrowserEvent, pathname = window.location.pathname): void {
  const route = analyticsRoute(pathname);
  const current = uploadAnalyticsContext();
  if (!route || !current) return;
  const payload = { event, event_id: crypto.randomUUID(), ...current, route };
  void fetch("/api/analytics/events", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(payload), credentials: "same-origin", keepalive: true,
  }).catch(() => { /* Usage measurement must never interfere with sharing. */ });
  // Share routes never send events to Google. Uploaded HTML is served separately.
  if (route !== "/s/:slug") sendGoogleEvent(event, route, current.acquisition);
}

export function trackPage(pathname: string): void {
  const route = analyticsRoute(pathname);
  if (configuredGa) (window as unknown as Record<string, unknown>)["ga-disable-" + configuredGa] =
    route === "/s/:slug" || readAnalyticsConsent() !== "granted";
  if (!route || readAnalyticsConsent() !== "granted" || !config.analyticsEnabled || lastPage === pathname) return;
  lastPage = pathname;
  trackBrowserEvent("page_view", pathname);
}

export function trackBrowserUploadSuccess(): void {
  const current = uploadAnalyticsContext();
  if (current && window.location.pathname === "/") sendGoogleEvent("share_created", "/", current.acquisition);
}

function sendGoogleEvent(event: string, route: string, acquisition: Acquisition): void {
  const id = config.ga4MeasurementId;
  if (!id || !/^G-[A-Z0-9]{5,20}$/.test(id) || readAnalyticsConsent() !== "granted") return;
  const target = window as AnalyticsWindow;
  if (!configuredGa) {
    target.dataLayer = target.dataLayer ?? [];
    target.gtag = function (..._args: unknown[]) { target.dataLayer!.push(arguments); };
    target.gtag("consent", "default", {
      analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    });
    target.gtag("js", new Date());
    target.gtag("config", id, {
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      cookie_domain: window.location.hostname, cookie_prefix: "sharehtml",
      cookie_flags: "SameSite=Lax;Secure",
      page_location: window.location.origin + route,
      page_referrer: acquisition.referrer_domain ? "https://" + acquisition.referrer_domain + "/" : "",
      page_title: "Share HTML",
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + id;
    script.setAttribute("referrerpolicy", "no-referrer");
    document.head.appendChild(script);
    configuredGa = id;
  }
  (window as unknown as Record<string, unknown>)["ga-disable-" + id] = false;
  target.gtag?.("consent", "update", { analytics_storage: "granted" });
  target.gtag?.("event", event, {
    send_to: id, page_location: window.location.origin + route, page_title: "Share HTML",
    page_referrer: acquisition.referrer_domain ? "https://" + acquisition.referrer_domain + "/" : "",
    ...(acquisition.source ? { campaign_source: acquisition.source } : {}),
    ...(acquisition.medium ? { campaign_medium: acquisition.medium } : {}),
    ...(acquisition.campaign ? { campaign_name: acquisition.campaign } : {}),
    acquisition_source: acquisition.source ?? "unknown",
    acquisition_medium: acquisition.medium ?? "unknown",
    acquisition_campaign: acquisition.campaign ?? "unknown",
    referrer_domain: acquisition.referrer_domain ?? "unknown",
    transport: "browser", actor_evidence: "browser_event_self_reported",
  });
}
