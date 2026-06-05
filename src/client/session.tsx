/**
 * Supabase session context.
 *
 * Provides the active Session and the SupabaseClient instance to the entire
 * component tree without prop-drilling.
 *
 * Kept in its own module so both router.tsx (for the root-route Header) and
 * main.tsx (for the App shell that owns the auth listener) can import from
 * here without creating a circular dependency.
 */
import React, { createContext, useContext } from "react";
import { Session, SupabaseClient } from "@supabase/supabase-js";
import { useNavigate } from "@tanstack/react-router";

const GITHUB_URL = "https://github.com/lifeodyssey/share-html";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type SessionCtxValue = {
  session: Session | null;
  supabase: SupabaseClient | null;
};

export const SessionContext = createContext<SessionCtxValue>({
  session: null,
  supabase: null,
});

export function useSession(): SessionCtxValue {
  return useContext(SessionContext);
}

// ---------------------------------------------------------------------------
// Header  (needs useNavigate from TanStack Router, so it lives here)
// ---------------------------------------------------------------------------

export function Header() {
  const { session, supabase } = useSession();
  const navigate = useNavigate();

  return (
    <header className="topbar">
      <button
        className="brand"
        onClick={() => void navigate({ to: "/" })}
        aria-label="Go home"
      >
        <LogoMark />
        <span className="brand-name">Share HTML</span>
      </button>
      <div className="account-strip">
        <a
          className="button ghost source-link"
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
        >
          <GitHubIcon />
          GitHub
        </a>
        {session?.user ? (
          <>
            <span className="account-email">{session.user.email}</span>
            <button
              className="button secondary"
              onClick={() => supabase?.auth.signOut()}
            >
              Sign out
            </button>
          </>
        ) : (
          <span className="account-email">
            Anonymous uploads expire in 365 days
          </span>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Inline icon components used by Header
// ---------------------------------------------------------------------------

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
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.1-1.47-1.1-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.35 1.08 2.92.83.09-.64.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.48 9.48 0 0 1 12 7.01c.85 0 1.7.11 2.5.34 1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.57c0 .26.18.57.69.48A10 10 0 0 0 12 2Z"
      />
    </svg>
  );
}
