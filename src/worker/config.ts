import { numberEnv } from "./utils.ts";

/**
 * Minimal structural interface covering env fields consumed by config accessors.
 * The full Env type in index.ts is a superset that satisfies this interface.
 */
export type ConfigEnv = {
  APP_ORIGIN?: string;
  PREVIEW_ORIGIN?: string;
  MAX_ANON_HTML_BYTES?: string;
  MAX_USER_HTML_BYTES?: string;
};

const DEFAULT_ANON_MAX_BYTES = 1024 * 1024;       // 1 MB
const DEFAULT_USER_MAX_BYTES = 5 * 1024 * 1024;   // 5 MB

/**
 * Return the maximum upload size in bytes for the given user context.
 * Reads MAX_USER_HTML_BYTES (authenticated) or MAX_ANON_HTML_BYTES (anonymous)
 * from the environment, applying the appropriate default when absent or invalid.
 */
export function maxUploadBytes(env: ConfigEnv, isAuthenticated: boolean): number {
  return isAuthenticated
    ? numberEnv(env.MAX_USER_HTML_BYTES, DEFAULT_USER_MAX_BYTES)
    : numberEnv(env.MAX_ANON_HTML_BYTES, DEFAULT_ANON_MAX_BYTES);
}

/**
 * Return the app origin for share URLs and CSP frame-ancestors.
 * Falls back to `requestOrigin` when APP_ORIGIN is not configured.
 */
export function appOrigin(env: ConfigEnv, requestOrigin: string): string {
  return env.APP_ORIGIN || requestOrigin;
}

/**
 * Return the preview origin for sandboxed preview URLs.
 * Falls back to `requestOrigin` when PREVIEW_ORIGIN is not configured.
 */
export function previewOrigin(env: ConfigEnv, requestOrigin: string): string {
  return env.PREVIEW_ORIGIN || requestOrigin;
}
