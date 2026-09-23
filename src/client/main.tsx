/**
 * Application entry point and route-level component definitions.
 *
 * Architecture after TanStack migration:
 *  - Root render: <QueryClientProvider> → <App>
 *  - App: loads config via useConfig(), initialises Supabase, attaches the
 *    onAuthStateChange listener, then renders <SessionContext.Provider> →
 *    <RouterProvider router={router}>.
 *  - Session state: managed by SessionContext (session.tsx); consumed by
 *    components via useSession().
 *  - Data fetching: all network calls go through hooks in queries.ts; no raw
 *    fetch() calls inside components.
 *  - Routing: TanStack Router handles URL matching; <Link> / useNavigate()
 *    replace manual pushState.
 *
 * Exported so router.tsx can reference them in the route tree:
 *   HomePage, SharePage
 */
import React, {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  createClient,
  Session,
} from "@supabase/supabase-js";
import { QueryClientProvider } from "@tanstack/react-query";
import { Link, RouterProvider, useNavigate, useParams } from "@tanstack/react-router";
import { Button, Chip, Spinner } from "@heroui/react";

import { queryClient } from "./queries";
import {
  useConfig,
  useMyShares,
  useShareAccess,
  useUploadShare,
  useDeleteShare,
  useClaimShare,
  useReportShare,
  useRotateShareAccessKey,
} from "./queries";
import type { RotateAccessKeyResult } from "./api";
import type { ShareVisibility } from "../shared/types";
import {
  exampleTemplateById,
  marketingPageForPath,
  type MarketingPage,
} from "../shared/marketing";
import { SessionContext, useSession } from "./session";
import { router } from "./router";
import "./theme.css";
import "./styles.css";
import { trackBrowserEvent } from "./analytics";

const PUBLIC_SITE_ORIGIN = "https://sharehtml.zhenjia.dev";
const HOME_TITLE = "Share HTML — Upload and Share Sandboxed HTML Previews";
const HOME_DESCRIPTION = "Upload one self-contained HTML file and share it in a sandboxed preview with an unlisted public link or an access-key-protected private link.";

type PageMetadata = {
  title: string;
  description: string;
  canonicalPath: string | null;
  index: boolean;
  ogType?: "website" | "article";
  schema?: unknown | null;
};

function upsertMeta(attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

function removeMeta(attribute: "name" | "property", key: string) {
  document.head.querySelectorAll(`meta[${attribute}="${key}"]`).forEach((element) => element.remove());
}

function usePageMetadata({
  title,
  description,
  canonicalPath,
  index,
  ogType = "website",
  schema = null,
}: PageMetadata) {
  const schemaJson = schema ? JSON.stringify(schema) : null;

  useEffect(() => {
    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta(
      "name",
      "robots",
      index ? "index, follow, max-image-preview:large" : "noindex, nofollow, noarchive, nosnippet, noimageindex"
    );
    upsertMeta("property", "og:type", ogType);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);

    const canonicalUrl = canonicalPath === null
      ? null
      : new URL(canonicalPath, PUBLIC_SITE_ORIGIN).toString();
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonicalUrl) {
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.rel = "canonical";
        document.head.appendChild(canonical);
      }
      canonical.href = canonicalUrl;
      upsertMeta("property", "og:url", canonicalUrl);
    } else {
      canonical?.remove();
      removeMeta("property", "og:url");
    }

    const schemas = [...document.head.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')];
    if (schemaJson) {
      const script = schemas.shift() ?? document.createElement("script");
      script.type = "application/ld+json";
      script.textContent = schemaJson;
      if (!script.isConnected) document.head.appendChild(script);
    }
    schemas.forEach((script) => script.remove());
    if (!schemaJson) {
      document.head.querySelectorAll('script[type="application/ld+json"]').forEach((script) => script.remove());
    }
  }, [canonicalPath, description, index, ogType, schemaJson, title]);
}

// ---------------------------------------------------------------------------
// SystemNotice – used before the router is ready (no routing context)
// ---------------------------------------------------------------------------

export function SystemNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="flex flex-col items-center justify-center min-h-[40vh] px-6 text-center">
      <div className="w-full max-w-md border border-border rounded-lg bg-surface p-8">
        <h1 className="text-2xl font-bold text-foreground mb-3">{title}</h1>
        <p className="text-muted text-sm">{detail}</p>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// lifecycleColor – maps a share lifecycle_status to a HeroUI Chip color.
// Values must match the LifecycleStatus union in src/shared/types.ts.
// ---------------------------------------------------------------------------

function lifecycleColor(status: string): "success" | "warning" | "danger" | "default" {
  if (status === "active") return "success";
  if (status === "needs_review") return "warning";
  if (status === "blocked" || status === "deleted" || status === "failed") return "danger";
  return "default";
}

function apiErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

// ---------------------------------------------------------------------------
// HomePage – index route component  /
// ---------------------------------------------------------------------------

export function HomePage() {
  usePageMetadata({
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    canonicalPath: "/",
    index: true,
    schema: {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Share HTML",
      url: PUBLIC_SITE_ORIGIN + "/",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any",
      description: HOME_DESCRIPTION,
    },
  });

  return (
    <div className="flex flex-col gap-16">
      {/* Hero section */}
      <section className="hero-grid pt-12 pb-10 border-b border-border">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-widest uppercase text-muted mb-3">
            Sandboxed HTML sharing
          </p>
          <h1 className="text-4xl lg:text-5xl font-bold text-foreground leading-tight tracking-tight mb-5">
            Upload one HTML file.<br />Share a live preview link.
          </h1>
          <p className="text-base text-muted leading-relaxed" style={{ maxWidth: "34rem" }}>
            Scripts can run, but every preview is isolated behind a sandbox and checked by a small
            risk scanner before it goes public.
          </p>
        </div>
        <div className="w-full">
          <UploadPanel />
        </div>
      </section>

      <section aria-labelledby="explore-share-html" className="pb-2">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase text-muted mb-2">
              Pick the shortest path
            </p>
            <h2 id="explore-share-html" className="text-2xl font-bold text-foreground tracking-tight">
              Built for quick review, private handoff, and agents.
            </h2>
          </div>
        </div>
        <div className="marketing-card-grid">
          <a className="marketing-card" href="/html-preview">
            <strong>Share an HTML preview</strong>
            <span>See the exact single-file boundary and three-step flow.</span>
          </a>
          <a className="marketing-card" href="/private-html-sharing">
            <strong>Protect it with a key</strong>
            <span>Understand what private links hide and how key exchange works.</span>
          </a>
          <a className="marketing-card" href="/examples">
            <strong>Start from an example</strong>
            <span>Preload a dashboard, product concept, or data brief.</span>
          </a>
          <a className="marketing-card" href="/agents">
            <strong>Connect an agent</strong>
            <span>Use MCP, OpenAPI, WebMCP, or the raw HTTP endpoint.</span>
          </a>
        </div>
      </section>

      {/* Lower grid: auth + dashboard */}
      <section className="grid grid-cols-1 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] gap-8 pb-12">
        <AuthPanel />
        <Dashboard />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// First-party acquisition pages
// ---------------------------------------------------------------------------

export function MarketingPageView({ path }: { path: string }) {
  const page = marketingPageForPath(path);
  if (!page) {
    return <SystemNotice title="Page unavailable" detail="This product guide could not be loaded." />;
  }

  return <MarketingPageContent page={page} />;
}

function MarketingPageContent({ page }: { page: MarketingPage }) {
  usePageMetadata({
    title: page.title,
    description: page.description,
    canonicalPath: page.path,
    index: true,
    ogType: page.schemaType === "TechArticle" ? "article" : "website",
    schema: {
      "@context": "https://schema.org",
      "@type": page.schemaType,
      name: page.title,
      headline: page.heading,
      description: page.description,
      url: PUBLIC_SITE_ORIGIN + page.path,
      isPartOf: { "@id": PUBLIC_SITE_ORIGIN + "/#website" },
    },
  });

  return (
    <article className="marketing-page">
      <header className="marketing-hero">
        <p className="text-xs font-semibold tracking-widest uppercase text-muted mb-3">
          {page.eyebrow}
        </p>
        <h1>{page.heading}</h1>
        <p className="marketing-lead">{page.lead}</p>
        <div className="marketing-actions">
          <a className="button primary" href={page.primaryCta.href}>
            {page.primaryCta.label}
          </a>
          {page.secondaryCta && (
            <a className="button secondary" href={page.secondaryCta.href}>
              {page.secondaryCta.label}
            </a>
          )}
        </div>
      </header>

      <div className="marketing-sections">
        {page.sections.map((section, index) => (
          <section
            className="marketing-section"
            id={page.path === "/agents" && index === 0 ? "mcp-quickstart" : undefined}
            key={section.title}
          >
            <p className="marketing-section-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </p>
            <div>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.bullets && (
                <ul>
                  {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                </ul>
              )}
              {section.code && <pre><code>{section.code}</code></pre>}
              {section.links && (
                <div className="marketing-resource-links">
                  {section.links.map((link) => (
                    <a className="button secondary" href={link.href} key={link.href}>
                      {link.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      <footer className="marketing-footer-cta">
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-muted mb-2">Ready to try it?</p>
          <h2>Create the link before you configure a deployment.</h2>
        </div>
        <a className="button primary" href={"/?source=" + growthSourceForPage(page.path)}>
          Upload HTML
        </a>
      </footer>
    </article>
  );
}

function growthSourceForPage(path: string): string {
  return path.slice(1).replace(/[^a-z0-9]+/g, "_");
}

// ---------------------------------------------------------------------------
// SharePage – share route component  /s/$slug
// ---------------------------------------------------------------------------

export function SharePage() {
  const { slug } = useParams({ from: "/s/$slug" });
  const { session } = useSession();
  const [accessKey, setAccessKey] = useState(readAccessKeyFromHash);
  const [submittedAccess, setSubmittedAccess] = useState(() => ({
    slug,
    key: readAccessKeyFromHash(),
  }));
  const [accessAttempt, setAccessAttempt] = useState(0);
  const accessStateMatchesSlug = submittedAccess.slug === slug;
  const submittedAccessKey = accessStateMatchesSlug ? submittedAccess.key : "";
  const { data: share, isPending: isLoading, error } = useShareAccess(slug, {
    accessKey: submittedAccessKey || undefined,
    accessToken: session?.access_token,
    viewerId: session?.user.id,
    attempt: accessAttempt,
    enabled: accessStateMatchesSlug,
  });
  const reportMutation = useReportShare();

  usePageMetadata({
    title: share?.title ? `${share.title} | Share HTML` : "Shared HTML | Share HTML",
    description: "Open a sandboxed HTML preview shared through Share HTML.",
    canonicalPath: share?.visibility === "public_unlisted" ? `/s/${encodeURIComponent(slug)}` : null,
    index: false,
    schema: null,
  });

  const [reportReason, setReportReason] = useState("phishing");
  const [reportDetails, setReportDetails] = useState("");

  useEffect(() => {
    const key = readAccessKeyFromHash();
    setAccessKey(key);
    setSubmittedAccess({ slug, key });
    setAccessAttempt(0);
  }, [slug]);

  useEffect(() => {
    const syncChangedFragment = () => {
      const key = readAccessKeyFromHash();
      setAccessKey(key);
      setSubmittedAccess({ slug, key });
      setAccessAttempt((attempt) => attempt + 1);
    };
    window.addEventListener("hashchange", syncChangedFragment);
    return () => window.removeEventListener("hashchange", syncChangedFragment);
  }, [slug]);

  useEffect(() => {
    if (!share || share.slug !== slug || !submittedAccessKey) return;
    removeAccessKeyFromHash(submittedAccessKey);
    setAccessKey((currentKey) =>
      currentKey.trim() === submittedAccessKey ? "" : currentKey
    );
  }, [share, slug, submittedAccessKey]);

  const unlock = (event: FormEvent) => {
    event.preventDefault();
    const key = accessKey.trim();
    if (!key) return;
    setSubmittedAccess({ slug, key });
    setAccessAttempt((attempt) => attempt + 1);
  };

  const report = (event: FormEvent) => {
    event.preventDefault();
    if (!share) return;
    reportMutation.mutate({
      shareId: share.id,
      reason: reportReason,
      details: reportDetails,
      accessToken: session?.access_token,
    });
  };

  const reportFeedback = reportMutation.isSuccess
    ? "Report received."
    : reportMutation.isError
    ? (reportMutation.error instanceof Error ? reportMutation.error.message : "Report failed.")
    : "";

  const accessErrorCode = apiErrorCode(error);
  const accessError = accessErrorCode === "share_access_required" ||
    accessErrorCode === "invalid_share_access_key";
  const statusMessage = isLoading
    ? "Loading share..."
    : error && !accessError
    ? error.message
    : reportFeedback;

  return (
    <section className="flex flex-col gap-6 pt-8 border-t border-border">
      {statusMessage && (
        <p className={`text-sm ${error && !accessError ? "text-danger" : "text-muted"}`} aria-live="polite">
          {statusMessage}
          {isLoading && <Spinner size="sm" color="current" className="ml-2 inline-block align-middle" />}
        </p>
      )}
      {accessError && (
        <form
          className="flex flex-col gap-4 max-w-md p-5 bg-surface border border-border rounded-lg"
          onSubmit={unlock}
        >
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase text-muted mb-1">
              Private share
            </p>
            <h1 className="text-2xl font-bold text-foreground">Access key required</h1>
            <p className="text-sm text-muted mt-2">
              Enter the key sent by the share owner. It is checked by the Worker before any metadata or HTML is returned.
            </p>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            <span>Access key</span>
            <input
              className="border border-border rounded-md bg-surface-alt text-foreground px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              required
            />
          </label>
          {accessErrorCode === "invalid_share_access_key" && (
            <p className="text-sm text-danger" role="alert">That access key is not valid.</p>
          )}
          <button className="button primary" type="submit">Unlock share</button>
        </form>
      )}
      <aside className="share-referral">
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-muted mb-1">
            Made with Share HTML
          </p>
          <p className="text-sm text-foreground">
            Have a prototype or generated HTML file of your own?
          </p>
        </div>
        <a className="button primary" href="/?source=shared_preview">
          Share your HTML
        </a>
      </aside>
      {share && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase text-muted mb-2">
                {share.visibility === "private_link" ? "Private access-key share" : "Public unlisted share"}
              </p>
              <h1 className="text-3xl font-bold text-foreground tracking-tight mb-3">
                {share.title || "Untitled HTML"}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <Chip
                  color={lifecycleColor(share.lifecycle_status)}
                  variant="soft"
                  size="md"
                >
                  {share.lifecycle_status}
                </Chip>
                <span className="text-sm text-muted">
                  risk {share.risk_score}
                </span>
                <span className="text-sm text-muted">
                  {share.expires_at
                    ? `expires ${new Date(share.expires_at).toLocaleDateString()}`
                    : "no expiry"}
                </span>
              </div>
            </div>
            <a
              className="button secondary"
              href={share.preview_url}
              target="_blank"
              rel="noreferrer"
            >
              Full preview
            </a>
          </div>

          {share.lifecycle_status === "active" || share.lifecycle_status === "needs_review" ? (
            <div className="rounded-lg border border-border overflow-hidden bg-surface">
              <iframe
                className="preview-frame"
                title={share.title || "Shared HTML preview"}
                src={share.preview_url}
                sandbox="allow-scripts allow-forms allow-popups allow-downloads"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <SystemNotice
              title="Preview unavailable"
              detail={`Current status: ${share.lifecycle_status}`}
            />
          )}

          {/* Report strip */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
            <p className="text-xs text-muted">See something harmful?</p>
            <form className="flex flex-wrap items-center gap-2" onSubmit={report}>
              <select
                className="text-sm border border-border rounded-md bg-surface text-foreground px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
              >
                <option value="phishing">Phishing</option>
                <option value="malware">Malware</option>
                <option value="copyright">Copyright</option>
                <option value="other">Other</option>
              </select>
              <input
                className="text-sm border border-border rounded-md bg-surface text-foreground px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Optional details"
              />
              <button className="button secondary" type="submit">Report</button>
            </form>
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// UploadPanel
// ---------------------------------------------------------------------------

function UploadPanel() {
  const { session } = useSession();
  const navigate = useNavigate();
  const uploadMutation = useUploadShare();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<ShareVisibility>(readRequestedVisibility);
  const [validationError, setValidationError] = useState("");
  const [exampleStatus, setExampleStatus] = useState("");
  const [growthSource] = useState(readGrowthSource);
  const fileRevision = useRef(0);
  const titleRevision = useRef(0);
  const exampleController = useRef<AbortController | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const example = exampleTemplateById(params.get("example"));
    if (!example) return;

    const controller = new AbortController();
    const startingFileRevision = fileRevision.current;
    const startingTitleRevision = titleRevision.current;
    exampleController.current = controller;
    setExampleStatus("Loading " + example.title + "...");
    void fetch(example.fileUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Example unavailable");
        return response.blob();
      })
      .then((blob) => {
        const fileIsUntouched = fileRevision.current === startingFileRevision;
        const titleIsUntouched = titleRevision.current === startingTitleRevision;
        if (fileIsUntouched) {
          setFile(new File([blob], example.id + ".html", { type: "text/html" }));
        }
        if (titleIsUntouched) setTitle(example.title);
        setExampleStatus(fileIsUntouched
          ? example.title + " is ready to share."
          : "Example load finished; kept your selected file.");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setExampleStatus("The example could not be loaded. Choose an HTML file instead.");
      })
      .finally(() => {
        if (exampleController.current === controller) exampleController.current = null;
      });
    return () => {
      controller.abort();
      if (exampleController.current === controller) exampleController.current = null;
    };
  }, []);

  const result = uploadMutation.data ?? null;
  const busy = uploadMutation.isPending;

  // Derive feedback kind and status message from mutation state.
  const feedbackKind: "idle" | "working" | "success" | "error" = validationError
    ? "error"
    : busy
    ? "working"
    : uploadMutation.isSuccess
    ? "success"
    : uploadMutation.isError
    ? "error"
    : "idle";

  const status = validationError
    ? validationError
    : busy
    ? "Uploading and scanning..."
    : uploadMutation.isSuccess
    ? "Your share is live."
    : uploadMutation.isError
    ? (uploadMutation.error instanceof Error ? uploadMutation.error.message : "Upload failed")
    : "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setValidationError("Choose an HTML file first.");
      return;
    }
    setValidationError("");
    uploadMutation.mutate({
      file,
      title,
      visibility,
      accessToken: session?.access_token,
      source: growthSource,
    });
  };

  const feedbackBg = {
    idle: "",
    working: "bg-warning/10 border-warning/40",
    success: "bg-success/10 border-success/40",
    error: "bg-danger/10 border-danger/40",
  }[feedbackKind];

  return (
    <form
      className="upload-panel flex flex-col gap-4 p-5 bg-surface border border-border rounded-lg"
      onSubmit={submit}
      aria-label="Upload an HTML file to share"
    >
      {exampleStatus && (
        <p className="text-sm text-muted" role="status">{exampleStatus}</p>
      )}

      {/* Title field */}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        <span>Title</span>
        <input
          className="border border-border rounded-md bg-surface-alt text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted"
          value={title}
          onChange={(e) => {
            titleRevision.current += 1;
            setTitle(e.target.value);
          }}
          placeholder="Tiny demo, receipt, prototype..."
        />
      </label>

      {/* Dropzone */}
      <label className="dropzone flex flex-col items-center justify-center gap-2 min-h-[140px] border-2 border-dashed border-border rounded-lg bg-surface-alt cursor-pointer hover:border-accent/60 transition-colors p-5 text-center">
        <input
          type="file"
          accept=".html,.htm,text/html"
          aria-label="Choose an HTML file"
          onChange={(e) => {
            fileRevision.current += 1;
            exampleController.current?.abort();
            exampleController.current = null;
            setExampleStatus("");
            setFile(e.target.files?.[0] ?? null);
          }}
          className="sr-only"
        />
        <span className={`font-mono text-sm font-semibold text-foreground overflow-wrap-anywhere ${file ? "text-foreground" : "text-muted"}`}>
          {file ? file.name : "Choose index.html"}
        </span>
        <span className="text-xs text-muted">
          {session ? "Up to 5 MB" : "Anonymous uploads up to 1 MB"}
        </span>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground mb-1">Who can open it?</legend>
        <label className="flex items-start gap-3 p-3 border border-border rounded-md bg-surface-alt cursor-pointer">
          <input
            type="radio"
            name="visibility"
            value="public_unlisted"
            checked={visibility === "public_unlisted"}
            onChange={() => setVisibility("public_unlisted")}
          />
          <span className="flex flex-col gap-0.5">
            <strong className="text-sm text-foreground">Public unlisted</strong>
            <small className="text-xs text-muted">Anyone with the link can open it. It is not added to the sitemap.</small>
          </span>
        </label>
        <label className="flex items-start gap-3 p-3 border border-border rounded-md bg-surface-alt cursor-pointer">
          <input
            type="radio"
            name="visibility"
            value="private_link"
            checked={visibility === "private_link"}
            onChange={() => setVisibility("private_link")}
          />
          <span className="flex flex-col gap-0.5">
            <strong className="text-sm text-foreground">Private with access key</strong>
            <small className="text-xs text-muted">Only someone with the generated key can load metadata or the preview.</small>
          </span>
        </label>
      </fieldset>

      {/* Primary action — one per view */}
      <button
        className="button primary w-full flex items-center justify-center gap-2"
        disabled={busy}
        type="submit"
      >
        {busy && <Spinner size="sm" color="current" />}
        {busy ? "Publishing..." : "Create share"}
      </button>

      {/* Feedback */}
      {status && feedbackKind !== "idle" && (
        <div
          className={`flex flex-col gap-1.5 rounded-md border px-4 py-3 text-sm ${feedbackBg}`}
          aria-live="polite"
        >
          <strong className="font-semibold text-foreground">{feedbackTitle(feedbackKind)}</strong>
          <span className="text-muted">{status}</span>
          {busy && (
            <div className="publish-steps mt-1" aria-label="Publish progress">
              <span>Upload</span>
              <span>Scan</span>
              <span>Publish</span>
            </div>
          )}
        </div>
      )}

      {/* Result block */}
      {result && (
        <div className="result-block flex flex-col gap-4 pt-4 border-t border-border">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase text-muted mb-1">
                Published
              </p>
              <h2 className="text-lg font-bold text-foreground">
                {result.share.title || "Untitled HTML"}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <a className="button secondary" href={result.share.share_url}>
                View page
              </a>
              {result.share.visibility === "public_unlisted" && (
                <a
                  className="button ghost"
                  href={result.share.preview_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Full preview
                </a>
              )}
            </div>
          </div>

          <CopyLine
            label={result.share.visibility === "private_link" ? "Protected link" : "Share URL"}
            value={result.share.share_url}
            href={result.share.share_url}
            description={result.share.visibility === "private_link"
              ? "Includes the key after #key=. Treat the complete link as a secret."
              : "Send this to people. It opens the unlisted page with safety context and the preview."}
          />
          {result.share.visibility === "private_link" && result.accessKey ? (
            <>
              <CopyLine
                label="Bare link"
                value={result.share.share_url.split("#")[0]}
                description="Send this separately from the access key for stronger separation."
              />
              <CopyLine
                label="Access key"
                value={result.accessKey}
                description="Shown once. The database stores only its peppered hash."
              />
            </>
          ) : (
            <CopyLine
              label="Preview URL"
              value={result.share.preview_url}
              href={result.share.preview_url}
              description="Direct sandboxed render of the uploaded HTML."
            />
          )}
          {result.claimToken && (
            <>
              <CopyLine
                label="Share ID"
                value={result.share.id}
                description="Paste this in the signed-in dashboard together with the claim token."
              />
              <CopyLine
                label="Claim token"
                value={result.claimToken}
                description="Private recovery code for attaching this anonymous upload to your account later."
              />
            </>
          )}
          {result.share.risk_reasons.length > 0 && (
            <ul className="flex flex-col gap-1 pl-4 list-disc text-sm text-danger">
              {result.share.risk_reasons.map((reason) => (
                <li key={reason.code}>{reason.detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

function readGrowthSource(): string {
  if (typeof window === "undefined") return "direct";
  const source = new URLSearchParams(window.location.search).get("source")?.toLowerCase() ?? "";
  return /^[a-z0-9_-]{1,64}$/.test(source) ? source : "direct";
}

function readRequestedVisibility(): ShareVisibility {
  if (typeof window === "undefined") return "public_unlisted";
  return new URLSearchParams(window.location.search).get("visibility") === "private_link"
    ? "private_link"
    : "public_unlisted";
}

function authRedirectUrl(): string {
  const redirect = new URL("/", window.location.origin);
  const current = new URL(window.location.href);
  const source = readGrowthSource();
  if (source !== "direct") redirect.searchParams.set("source", source);

  const example = exampleTemplateById(current.searchParams.get("example"));
  if (example) redirect.searchParams.set("example", example.id);
  if (readRequestedVisibility() === "private_link") {
    redirect.searchParams.set("visibility", "private_link");
  }
  return redirect.toString();
}

// ---------------------------------------------------------------------------
// AuthPanel
// ---------------------------------------------------------------------------

function AuthPanel() {
  const { session, supabase } = useSession();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [linkSent, setLinkSent] = useState(false);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setLinkSent(false);
    setMessage("Sending link...");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setLinkSent(true);
    setMessage("Check your email for the login link.");
  };

  const mailboxUrl = getMailboxUrl(email);

  return (
    <section className="flex flex-col gap-4 p-5 bg-surface border border-border rounded-lg">
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase text-muted mb-1">Account</p>
        <h2 className="text-xl font-bold text-foreground">
          {session ? "Signed in" : "Keep your shares"}
        </h2>
      </div>
      {session ? (
        <p className="text-sm text-muted">
          Uploaded shares stay attached to this Supabase account until you delete them.
        </p>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={signIn}>
          <input
            className="border border-border rounded-md bg-surface-alt text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="you@example.com"
            required
          />
          <button className="button secondary" type="submit">Send link</button>
        </form>
      )}
      {message && (
        <div className="flex items-center justify-between gap-3 mt-1">
          <p className="text-sm text-muted">{message}</p>
          {linkSent && mailboxUrl && (
            <a className="button ghost" href={mailboxUrl} target="_blank" rel="noreferrer">
              Open inbox
            </a>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard() {
  const { session } = useSession();
  const { data: shares = [], error: sharesError } = useMyShares(session?.user.id, session?.access_token);
  const deleteMutation = useDeleteShare();
  const claimMutation = useClaimShare();
  const rotateAccessKeyMutation = useRotateShareAccessKey();
  const navigate = useNavigate();

  const [claimToken, setClaimToken] = useState("");
  const [claimShareId, setClaimShareId] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [rotatedAccess, setRotatedAccess] = useState<RotateAccessKeyResult | null>(null);

  const deleteShare = async (id: string) => {
    if (!session) return;
    try {
      await deleteMutation.mutateAsync({ id, accessToken: session.access_token });
      setActionMessage("Deleted.");
    } catch {
      setActionMessage("Delete failed.");
    }
  };

  const claim = async (event: FormEvent) => {
    event.preventDefault();
    if (!session) return;
    try {
      await claimMutation.mutateAsync({
        shareId: claimShareId,
        claimToken,
        accessToken: session.access_token,
      });
      setActionMessage("Claimed.");
      setClaimShareId("");
      setClaimToken("");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Claim failed.");
    }
  };

  const rotateAccessKey = async (shareId: string) => {
    if (!session) return;
    try {
      const result = await rotateAccessKeyMutation.mutateAsync({
        shareId,
        accessToken: session.access_token,
      });
      setRotatedAccess(result);
      setActionMessage("Access key rotated. Old links stop unlocking new previews immediately.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not rotate access key.");
    }
  };

  return (
    <section className="flex flex-col gap-4 p-5 bg-surface border border-border rounded-lg">
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase text-muted mb-1">Library</p>
        <h2 className="text-xl font-bold text-foreground">Your shares</h2>
      </div>
      {!session ? (
        <p className="text-sm text-muted">
          Sign in to keep shares, remove them later, or claim anonymous uploads.
        </p>
      ) : (
        <>
          {/* Claim form */}
          <form className="flex flex-wrap items-center gap-2" onSubmit={claim}>
            <input
              className="flex-1 min-w-[120px] border border-border rounded-md bg-surface-alt text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted"
              value={claimShareId}
              onChange={(e) => setClaimShareId(e.target.value)}
              placeholder="Anonymous share id"
            />
            <input
              className="flex-1 min-w-[120px] border border-border rounded-md bg-surface-alt text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted"
              value={claimToken}
              onChange={(e) => setClaimToken(e.target.value)}
              placeholder="Claim token"
            />
            <button className="button secondary" type="submit">Claim</button>
          </form>

          {/* Share list */}
          <div className="flex flex-col divide-y divide-border">
            {shares.length === 0 ? (
              <p className="text-sm text-muted py-2">No shares yet.</p>
            ) : (
              shares.map((share) => (
                <article className="flex items-center justify-between gap-3 py-3" key={share.id}>
                  <div className="flex flex-col gap-1 min-w-0">
                    <strong className="text-sm font-semibold text-foreground truncate">
                      {share.title || "Untitled HTML"}
                    </strong>
                    <div className="flex items-center gap-2">
                      <Chip
                        color={lifecycleColor(share.lifecycle_status)}
                        variant="soft"
                        size="md"
                      >
                        {share.lifecycle_status}
                      </Chip>
                      <span className="text-xs text-muted">{formatBytes(share.size_bytes)}</span>
                      <span className="text-xs text-muted">
                        {share.visibility === "private_link" ? "private" : "unlisted"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      className="button ghost"
                      onClick={() =>
                        void navigate({ to: "/s/$slug", params: { slug: share.slug } })
                      }
                    >
                      Open
                    </button>
                    {share.visibility === "private_link" && (
                      <button
                        className="button ghost"
                        onClick={() => void rotateAccessKey(share.id)}
                        disabled={rotateAccessKeyMutation.isPending}
                      >
                        New key
                      </button>
                    )}
                    <button
                      className="button ghost danger"
                      onClick={() => deleteShare(share.id)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
          {rotatedAccess && (
            <div className="flex flex-col gap-2 pt-3 border-t border-border">
              <p className="text-sm font-semibold text-foreground">New private access</p>
              <CopyLine
                label="Protected link"
                value={rotatedAccess.share.share_url}
                href={rotatedAccess.share.share_url}
                description="This replaces every previously shared key for this page."
              />
              <CopyLine
                label="Access key"
                value={rotatedAccess.accessKey}
                description="Copy it now; only its hash is stored."
              />
            </div>
          )}
        </>
      )}
      {sharesError && <p className="text-sm text-danger mt-1">{sharesError.message}</p>}
      {actionMessage && <p className="text-sm text-muted mt-1">{actionMessage}</p>}
    </section>
  );
}

function readAccessKeyFromHash(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.hash.slice(1)).get("key")?.trim() ?? "";
}

function removeAccessKeyFromHash(expectedKey: string): boolean {
  if (typeof window === "undefined") return false;
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (fragment.get("key")?.trim() !== expectedKey) return false;
  fragment.delete("key");
  const remainingFragment = fragment.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${remainingFragment ? `#${remainingFragment}` : ""}`;
  window.history.replaceState(window.history.state, "", nextUrl);
  return true;
}

// ---------------------------------------------------------------------------
// CopyLine – mono value with copy + open actions
// ---------------------------------------------------------------------------

function CopyLine({
  label,
  value,
  description,
  href,
}: {
  label: string;
  value: string;
  description?: string;
  href?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    if (href) trackBrowserEvent("share_link_copied");
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 border border-border rounded-md bg-surface-alt px-3 py-2.5 text-sm">
      {/* Label + description */}
      <div className="flex flex-col gap-0.5 sm:w-32 shrink-0">
        <strong className="font-semibold text-foreground">{label}</strong>
        {description && (
          <small className="text-xs text-muted leading-snug">{description}</small>
        )}
      </div>
      {/* Mono value */}
      <code className="flex-1 font-mono text-xs text-accent overflow-hidden text-ellipsis whitespace-nowrap min-w-0 self-center">
        {value}
      </code>
      {/* Actions */}
      <span className="flex items-center gap-1.5 shrink-0">
        {href && (
          <a
            className="button ghost icon-button"
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${label}`}
          >
            <OpenIcon />
            Open
          </a>
        )}
        <button type="button" className="button ghost icon-button" onClick={copy}>
          <CopyIcon />
          {copied ? "Copied" : "Copy"}
        </button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function OpenIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M14 4h6v6h-2V7.41l-8.3 8.3-1.4-1.42 8.29-8.29H14V4Z" />
      <path fill="currentColor" d="M5 6h6v2H7v9h9v-4h2v6H5V6Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3v-2a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1H8Z"
      />
      <path
        fill="currentColor"
        d="M4 11a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6Zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H7Z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function feedbackTitle(kind: "idle" | "working" | "success" | "error") {
  if (kind === "working") return "Preparing your share";
  if (kind === "success") return "Published";
  if (kind === "error") return "Needs attention";
  return "Ready";
}

function getMailboxUrl(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "";
  if (domain === "gmail.com" || domain === "googlemail.com")
    return "https://mail.google.com/mail/u/0/#inbox";
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain))
    return "https://outlook.live.com/mail/0/inbox";
  if (domain === "qq.com") return "https://mail.qq.com";
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com")
    return "https://www.icloud.com/mail";
  return "";
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

// ---------------------------------------------------------------------------
// App shell
// Loads config via useConfig() (TanStack Query), initialises Supabase,
// attaches the auth listener, then renders the router inside SessionContext.
// ---------------------------------------------------------------------------

function App() {
  const { data: config, error: configError } = useConfig();

  const supabase = useMemo(() => {
    if (!config) return null;
    return createClient(config.supabaseUrl, config.supabasePublishableKey);
  }, [config]);

  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) return;
    // Hydrate existing session on mount
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    // Keep in sync on login / logout (reactive – useMyShares re-runs when
    // session changes because its query key includes the access token)
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  if (configError)
    return <SystemNotice title="Configuration error" detail={configError.message} />;
  if (!config || !supabase)
    return <SystemNotice title="Preparing app" detail="Loading Supabase configuration." />;

  return (
    <SessionContext.Provider value={{ session, supabase }}>
      <RouterProvider router={router} />
    </SessionContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Bootstrap – only runs in the browser (not during test module imports)
// ---------------------------------------------------------------------------

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}
