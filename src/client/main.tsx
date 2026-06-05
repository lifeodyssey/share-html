import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, Session, SupabaseClient, User } from "@supabase/supabase-js";
import type { PublicShare } from "../shared/types";
import "./styles.css";

type AppConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

type UploadResult = {
  share: PublicShare;
  claimToken: string | null;
  message: string;
};

type ApiError = {
  error?: string;
};

const GITHUB_URL = "https://github.com/lifeodyssey/share-html";

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [route, setRoute] = useState(() => window.location.pathname);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.ok ? response.json<AppConfig>() : Promise.reject(new Error("Config unavailable")))
      .then(setConfig)
      .catch((error: Error) => setConfigError(error.message));
  }, []);

  const supabase = useMemo(() => {
    if (!config) return null;
    return createClient(config.supabaseUrl, config.supabasePublishableKey);
  }, [config]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    const onPopState = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setRoute(path);
  };

  if (configError) return <SystemNotice title="Configuration error" detail={configError} />;
  if (!config || !supabase) return <SystemNotice title="Preparing app" detail="Loading Supabase configuration." />;

  const slugMatch = route.match(/^\/s\/([^/]+)$/);

  return (
    <main className="app-shell">
      <Header
        user={session?.user ?? null}
        supabase={supabase}
        onHome={() => navigate("/")}
      />

      {slugMatch ? (
        <SharePage slug={slugMatch[1]} session={session} />
      ) : (
        <HomePage supabase={supabase} session={session} onOpenShare={(slug) => navigate(`/s/${slug}`)} />
      )}
    </main>
  );
}

function Header({ user, supabase, onHome }: { user: User | null; supabase: SupabaseClient; onHome: () => void }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} aria-label="Go home">
        <LogoMark />
        <span className="brand-name">Share HTML</span>
      </button>
      <div className="account-strip">
        <a className="button ghost source-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
          <GitHubIcon />
          GitHub
        </a>
        {user ? (
          <>
            <span className="account-email">{user.email}</span>
            <button className="button secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </>
        ) : (
          <span className="account-email">Anonymous uploads expire in 365 days</span>
        )}
      </div>
    </header>
  );
}

function HomePage({ supabase, session, onOpenShare }: { supabase: SupabaseClient; session: Session | null; onOpenShare: (slug: string) => void }) {
  return (
    <div className="workspace">
      <section className="upload-surface">
        <div className="surface-copy">
          <p className="eyebrow">Sandboxed HTML sharing</p>
          <h1>Upload one HTML file. Share a live preview link.</h1>
          <p className="surface-description">
            Scripts can run, but every preview is isolated behind a sandbox and checked by a small risk scanner before it goes public.
          </p>
        </div>
        <UploadPanel session={session} onOpenShare={onOpenShare} />
      </section>

      <section className="lower-grid">
        <AuthPanel supabase={supabase} session={session} />
        <Dashboard session={session} onOpenShare={onOpenShare} />
      </section>
    </div>
  );
}

function UploadPanel({ session, onOpenShare }: { session: Session | null; onOpenShare: (slug: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<"idle" | "working" | "success" | "error">("idle");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setStatus("Choose an HTML file first.");
      setFeedbackKind("error");
      return;
    }

    setBusy(true);
    setStatus("Uploading and scanning...");
    setFeedbackKind("working");
    setResult(null);

    const body = new FormData();
    body.set("file", file);
    body.set("title", title);

    try {
      const response = await fetch("/api/shares", {
        method: "POST",
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        body
      });
      const payload = await response.json<UploadResult & ApiError>();
      if (!response.ok) throw new Error(payload.error ?? "Upload failed");
      setResult(payload);
      setStatus("Your share is live.");
      setFeedbackKind("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
      setFeedbackKind("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="upload-panel" onSubmit={submit} aria-label="Upload an HTML file to share">
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tiny demo, receipt, prototype..." />
      </label>

      <label className="dropzone">
        <input
          type="file"
          accept=".html,.htm,text/html"
          aria-label="Choose an HTML file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <span className="dropzone-main">{file ? file.name : "Choose index.html"}</span>
        <span className="dropzone-sub">{session ? "Up to 5 MB" : "Anonymous uploads up to 1 MB"}</span>
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
              <button type="button" className="button secondary" onClick={() => onOpenShare(result.share.slug)}>
                View page
              </button>
              <a className="button ghost" href={result.share.preview_url} target="_blank" rel="noreferrer">
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

function AuthPanel({ supabase, session }: { supabase: SupabaseClient; session: Session | null }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [linkSent, setLinkSent] = useState(false);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setLinkSent(false);
    setMessage("Sending link...");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
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
        <p className="muted">Uploaded shares stay attached to this Supabase account until you delete them.</p>
      ) : (
        <form className="inline-form" onSubmit={signIn}>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@example.com" required />
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

function Dashboard({ session, onOpenShare }: { session: Session | null; onOpenShare: (slug: string) => void }) {
  const [shares, setShares] = useState<PublicShare[]>([]);
  const [claimToken, setClaimToken] = useState("");
  const [claimShareId, setClaimShareId] = useState("");
  const [message, setMessage] = useState("");

  const loadShares = async () => {
    if (!session) return;
    const response = await fetch("/api/shares", {
      headers: { authorization: `Bearer ${session.access_token}` }
    });
    const payload = await response.json<{ shares?: PublicShare[] } & ApiError>();
    if (response.ok) setShares(payload.shares ?? []);
    else setMessage(payload.error ?? "Could not load shares");
  };

  useEffect(() => {
    loadShares();
  }, [session?.access_token]);

  const deleteShare = async (id: string) => {
    if (!session) return;
    const response = await fetch(`/api/shares/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${session.access_token}` }
    });
    setMessage(response.ok ? "Deleted." : "Delete failed.");
    await loadShares();
  };

  const claim = async (event: FormEvent) => {
    event.preventDefault();
    if (!session) return;
    const response = await fetch(`/api/shares/${claimShareId}/claim`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ claimToken })
    });
    const payload = await response.json<ApiError>();
    setMessage(response.ok ? "Claimed." : payload.error ?? "Claim failed.");
    await loadShares();
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <p className="eyebrow">Library</p>
        <h2>Your shares</h2>
      </div>
      {!session ? (
        <p className="muted">Sign in to keep shares, remove them later, or claim anonymous uploads.</p>
      ) : (
        <>
          <form className="claim-form" onSubmit={claim}>
            <input value={claimShareId} onChange={(event) => setClaimShareId(event.target.value)} placeholder="Anonymous share id" />
            <input value={claimToken} onChange={(event) => setClaimToken(event.target.value)} placeholder="Claim token" />
            <button className="button secondary">Claim</button>
          </form>
          <div className="share-list">
            {shares.length === 0 ? (
              <p className="muted">No shares yet.</p>
            ) : shares.map((share) => (
              <article className="share-row" key={share.id}>
                <div>
                  <strong>{share.title || "Untitled HTML"}</strong>
                  <span>{share.lifecycle_status} · {formatBytes(share.size_bytes)}</span>
                </div>
                <div className="row-actions">
                  <button className="button ghost" onClick={() => onOpenShare(share.slug)}>Open</button>
                  <button className="button ghost danger" onClick={() => deleteShare(share.id)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {message && <p className="status-line">{message}</p>}
    </section>
  );
}

function SharePage({ slug, session }: { slug: string; session: Session | null }) {
  const [share, setShare] = useState<PublicShare | null>(null);
  const [message, setMessage] = useState("Loading share...");
  const [reportReason, setReportReason] = useState("phishing");
  const [reportDetails, setReportDetails] = useState("");

  useEffect(() => {
    fetch(`/api/public/shares/${slug}`)
      .then(async (response) => {
        const payload = await response.json<{ share?: PublicShare } & ApiError>();
        if (!response.ok || !payload.share) throw new Error(payload.error ?? "Share not found");
        setShare(payload.share);
        setMessage("");
      })
      .catch((error: Error) => setMessage(error.message));
  }, [slug]);

  const report = async (event: FormEvent) => {
    event.preventDefault();
    if (!share) return;
    const response = await fetch(`/api/shares/${share.id}/report`, {
      method: "POST",
      headers: {
        ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        "content-type": "application/json"
      },
      body: JSON.stringify({ reason: reportReason, details: reportDetails })
    });
    setMessage(response.ok ? "Report received." : "Report failed.");
  };

  return (
    <section className="share-page">
      {message && <p className="status-line">{message}</p>}
      {share && (
        <>
          <div className="share-header">
            <div>
              <p className="eyebrow">Public unlisted share</p>
              <h1>{share.title || "Untitled HTML"}</h1>
              <p className="muted">
                {share.lifecycle_status} · risk {share.risk_score} · {share.expires_at ? `expires ${new Date(share.expires_at).toLocaleDateString()}` : "no expiry"}
              </p>
            </div>
            <a className="button secondary" href={share.preview_url} target="_blank" rel="noreferrer">Full preview</a>
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
            <SystemNotice title="Preview unavailable" detail={`Current status: ${share.lifecycle_status}`} />
          )}

          <form className="report-strip" onSubmit={report}>
            <select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
              <option value="phishing">Phishing</option>
              <option value="malware">Malware</option>
              <option value="copyright">Copyright</option>
              <option value="other">Other</option>
            </select>
            <input value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} placeholder="Optional details" />
            <button className="button secondary">Report</button>
          </form>
        </>
      )}
    </section>
  );
}

function CopyLine({ label, value, description, href }: { label: string; value: string; description?: string; href?: string }) {
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
          <a className="button ghost icon-button" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${label}`}>
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

function LogoMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <img src="/logo.svg" alt="" />
    </span>
  );
}

function GitHubIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.1-1.47-1.1-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.35 1.08 2.92.83.09-.64.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.48 9.48 0 0 1 12 7.01c.85 0 1.7.11 2.5.34 1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.57c0 .26.18.57.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

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
      <path fill="currentColor" d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3v-2a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1H8Z" />
      <path fill="currentColor" d="M4 11a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6Zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H7Z" />
    </svg>
  );
}

function feedbackTitle(kind: "idle" | "working" | "success" | "error") {
  if (kind === "working") return "Preparing your share";
  if (kind === "success") return "Published";
  if (kind === "error") return "Needs attention";
  return "Ready";
}

function getMailboxUrl(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "https://mail.google.com/mail/u/0/#inbox";
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) return "https://outlook.live.com/mail/0/inbox";
  if (domain === "qq.com") return "https://mail.qq.com";
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") return "https://www.icloud.com/mail";
  return "";
}

function SystemNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="system-notice">
      <h1>{title}</h1>
      <p>{detail}</p>
    </main>
  );
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

createRoot(document.getElementById("root")!).render(<App />);
