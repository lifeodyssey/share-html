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
        <span className="brand-mark">HTML</span>
        <span>Share HTML</span>
      </button>
      <div className="account-strip">
        {user ? (
          <>
            <span className="account-email">{user.email}</span>
            <button className="button secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </>
        ) : (
          <span className="account-email">Anonymous uploads expire in 7 days</span>
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
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setStatus("Choose an HTML file first.");
      return;
    }

    setBusy(true);
    setStatus("Uploading and scanning...");
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
      setStatus(payload.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="upload-panel" onSubmit={submit}>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Prototype, receipt mockup, tiny demo..." />
      </label>

      <label className="dropzone">
        <input
          type="file"
          accept=".html,.htm,text/html"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <span className="dropzone-main">{file ? file.name : "Choose index.html"}</span>
        <span className="dropzone-sub">{session ? "Up to 5 MB" : "Anonymous uploads up to 1 MB"}</span>
      </label>

      <button className="button primary" disabled={busy}>{busy ? "Scanning..." : "Create share"}</button>
      {status && <p className="status-line">{status}</p>}

      {result && (
        <div className="result-block">
          <button type="button" className="link-button" onClick={() => onOpenShare(result.share.slug)}>
            Open share page
          </button>
          <CopyLine label="Share URL" value={result.share.share_url} />
          <CopyLine label="Preview URL" value={result.share.preview_url} />
          {result.claimToken && (
            <CopyLine label="Claim token" value={result.claimToken} />
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

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("Sending link...");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    setMessage(error ? error.message : "Check your email for the login link.");
  };

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
      {message && <p className="status-line">{message}</p>}
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

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="copy-line">
      <span>{label}</span>
      <code>{value}</code>
      <button type="button" className="button ghost" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
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
