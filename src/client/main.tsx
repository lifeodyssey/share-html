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
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  createClient,
  Session,
} from "@supabase/supabase-js";
import { QueryClientProvider } from "@tanstack/react-query";
import { Link, RouterProvider, useNavigate, useParams } from "@tanstack/react-router";

import { queryClient } from "./queries";
import {
  useConfig,
  useMyShares,
  usePublicShare,
  useUploadShare,
  useDeleteShare,
  useClaimShare,
  useReportShare,
} from "./queries";
import { SessionContext, useSession } from "./session";
import { router } from "./router";
import "./styles.css";

// ---------------------------------------------------------------------------
// SystemNotice – used before the router is ready (no routing context)
// ---------------------------------------------------------------------------

export function SystemNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="system-notice">
      <h1>{title}</h1>
      <p>{detail}</p>
    </main>
  );
}

// ---------------------------------------------------------------------------
// HomePage – index route component  /
// ---------------------------------------------------------------------------

export function HomePage() {
  return (
    <div className="workspace">
      <section className="upload-surface">
        <div className="surface-copy">
          <p className="eyebrow">Sandboxed HTML sharing</p>
          <h1>Upload one HTML file. Share a live preview link.</h1>
          <p className="surface-description">
            Scripts can run, but every preview is isolated behind a sandbox and checked by a small
            risk scanner before it goes public.
          </p>
        </div>
        <UploadPanel />
      </section>

      <section className="lower-grid">
        <AuthPanel />
        <Dashboard />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SharePage – share route component  /s/$slug
// ---------------------------------------------------------------------------

export function SharePage() {
  const { slug } = useParams({ from: "/s/$slug" });
  const { session } = useSession();
  const { data: share, isPending: isLoading, error } = usePublicShare(slug);
  const reportMutation = useReportShare();

  const [reportReason, setReportReason] = useState("phishing");
  const [reportDetails, setReportDetails] = useState("");

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

  const statusMessage = isLoading
    ? "Loading share..."
    : error
    ? error.message
    : reportFeedback;

  return (
    <section className="share-page">
      {statusMessage && <p className="status-line">{statusMessage}</p>}
      {share && (
        <>
          <div className="share-header">
            <div>
              <p className="eyebrow">Public unlisted share</p>
              <h1>{share.title || "Untitled HTML"}</h1>
              <p className="muted">
                {share.lifecycle_status} · risk {share.risk_score} ·{" "}
                {share.expires_at
                  ? `expires ${new Date(share.expires_at).toLocaleDateString()}`
                  : "no expiry"}
              </p>
            </div>
            <a className="button secondary" href={share.preview_url} target="_blank" rel="noreferrer">
              Full preview
            </a>
          </div>

          {share.lifecycle_status === "active" || share.lifecycle_status === "needs_review" ? (
            <iframe
              className="preview-frame"
              title={share.title || "Shared HTML preview"}
              src={share.preview_url}
              sandbox="allow-scripts allow-forms allow-popups allow-downloads"
              referrerPolicy="no-referrer"
            />
          ) : (
            <SystemNotice
              title="Preview unavailable"
              detail={`Current status: ${share.lifecycle_status}`}
            />
          )}

          <form className="report-strip" onSubmit={report}>
            <select value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
              <option value="phishing">Phishing</option>
              <option value="malware">Malware</option>
              <option value="copyright">Copyright</option>
              <option value="other">Other</option>
            </select>
            <input
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="Optional details"
            />
            <button className="button secondary">Report</button>
          </form>
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
  const [validationError, setValidationError] = useState("");

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
      accessToken: session?.access_token,
    });
  };

  return (
    <form className="upload-panel" onSubmit={submit} aria-label="Upload an HTML file to share">
      <label className="field">
        <span>Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Tiny demo, receipt, prototype..."
        />
      </label>

      <label className="dropzone">
        <input
          type="file"
          accept=".html,.htm,text/html"
          aria-label="Choose an HTML file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <span className="dropzone-main">{file ? file.name : "Choose index.html"}</span>
        <span className="dropzone-sub">
          {session ? "Up to 5 MB" : "Anonymous uploads up to 1 MB"}
        </span>
      </label>

      <button className="button primary" disabled={busy}>
        {busy ? "Publishing..." : "Create share"}
      </button>
      {status && (
        <div className={`upload-feedback ${feedbackKind}`} aria-live="polite">
          <strong>{feedbackTitle(feedbackKind)}</strong>
          <span>{status}</span>
          {busy && (
            <div className="publish-steps" aria-label="Publish progress">
              <span>Upload</span>
              <span>Scan</span>
              <span>Publish</span>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="result-block">
          <div className="result-heading">
            <div>
              <p className="eyebrow">Published</p>
              <h2>{result.share.title || "Untitled HTML"}</h2>
            </div>
            <div className="result-actions">
              <Link
                to="/s/$slug"
                params={{ slug: result.share.slug }}
                className="button secondary"
              >
                View page
              </Link>
              <a
                className="button ghost"
                href={result.share.preview_url}
                target="_blank"
                rel="noreferrer"
              >
                Full preview
              </a>
            </div>
          </div>
          <CopyLine
            label="Share URL"
            value={result.share.share_url}
            href={result.share.share_url}
            description="Send this to people. It opens the public page with status, safety context, and the embedded preview."
          />
          <CopyLine
            label="Preview URL"
            value={result.share.preview_url}
            href={result.share.preview_url}
            description="Direct sandboxed render of the uploaded HTML. Useful when you only want to see the page itself."
          />
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
            <ul className="risk-list">
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
      options: { emailRedirectTo: window.location.origin },
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
    <section className="panel">
      <div className="panel-heading">
        <p className="eyebrow">Account</p>
        <h2>{session ? "Signed in" : "Keep your shares"}</h2>
      </div>
      {session ? (
        <p className="muted">
          Uploaded shares stay attached to this Supabase account until you delete them.
        </p>
      ) : (
        <form className="inline-form" onSubmit={signIn}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="you@example.com"
            required
          />
          <button className="button secondary">Send link</button>
        </form>
      )}
      {message && (
        <div className="mail-feedback">
          <p className="status-line">{message}</p>
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
  const navigate = useNavigate();

  const [claimToken, setClaimToken] = useState("");
  const [claimShareId, setClaimShareId] = useState("");
  const [actionMessage, setActionMessage] = useState("");

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

  return (
    <section className="panel">
      <div className="panel-heading">
        <p className="eyebrow">Library</p>
        <h2>Your shares</h2>
      </div>
      {!session ? (
        <p className="muted">
          Sign in to keep shares, remove them later, or claim anonymous uploads.
        </p>
      ) : (
        <>
          <form className="claim-form" onSubmit={claim}>
            <input
              value={claimShareId}
              onChange={(e) => setClaimShareId(e.target.value)}
              placeholder="Anonymous share id"
            />
            <input
              value={claimToken}
              onChange={(e) => setClaimToken(e.target.value)}
              placeholder="Claim token"
            />
            <button className="button secondary">Claim</button>
          </form>
          <div className="share-list">
            {shares.length === 0 ? (
              <p className="muted">No shares yet.</p>
            ) : (
              shares.map((share) => (
                <article className="share-row" key={share.id}>
                  <div>
                    <strong>{share.title || "Untitled HTML"}</strong>
                    <span>
                      {share.lifecycle_status} · {formatBytes(share.size_bytes)}
                    </span>
                  </div>
                  <div className="row-actions">
                    <button
                      className="button ghost"
                      onClick={() =>
                        void navigate({ to: "/s/$slug", params: { slug: share.slug } })
                      }
                    >
                      Open
                    </button>
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
        </>
      )}
      {sharesError && <p className="status-line">{sharesError.message}</p>}
      {actionMessage && <p className="status-line">{actionMessage}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// CopyLine
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
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="copy-line">
      <span className="copy-meta">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <code>{value}</code>
      <span className="copy-actions">
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
