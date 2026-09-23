import { reportWebMcpState } from "./webmcp";
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useConfig } from "./queries";
import { configureAnalytics, privacySignal, readAnalyticsConsent, setAnalyticsConsent, trackPage, type Consent } from "./analytics";

export function AnalyticsNotice() {
  const { data: config } = useConfig();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [consent, setConsent] = useState<Consent>(readAnalyticsConsent);
  const [open, setOpen] = useState(consent === null);
  useEffect(() => {
    configureAnalytics(config ?? {});
    trackPage(pathname);
    reportWebMcpState();
  }, [config, pathname, consent]);
  if (!config?.analyticsEnabled) return null;
  const choose = (value: "granted" | "denied") => {
    setAnalyticsConsent(value);
    setConsent(readAnalyticsConsent());
    setOpen(false);
  };
  return <aside className="analytics-notice" aria-label="Usage analytics preferences">
    {open ? <>
      <div><strong>Help improve Share HTML</strong>
        <p>Allow optional usage analytics{config.ga4MeasurementId ? ", including Google Analytics," : ""} to understand how people find and use the site.
          File contents, titles, and access keys are never included. Basic service activity is counted separately.</p>
        {privacySignal() && <p>Your browser privacy preference keeps optional analytics off.</p>}
      </div>
      <div className="analytics-notice-actions">
        <button type="button" className="button secondary" onClick={() => choose("granted")} disabled={privacySignal()}>Allow analytics</button>
        <button type="button" className="button ghost" onClick={() => choose("denied")}>No thanks</button>
      </div>
    </> : <button type="button" className="button ghost" onClick={() => setOpen(true)}>Analytics preferences</button>}
  </aside>;
}
