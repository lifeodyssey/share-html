import type { ShareRecord } from "../shared/types.ts";
import { base64Url } from "./db.ts";
import { hashText } from "./utils.ts";

type ShareAccessEnv = {
  SHARE_ACCESS_PEPPER_V1: string;
  PREVIEW_GRANT_SIGNING_KEY_V1: string;
};

type ShareGrantAudience = "metadata" | "preview";

type ShareGrant = {
  shareId: string;
  slug: string;
  audience: ShareGrantAudience;
  expiresAt: number;
};

const ACCESS_KEY_BYTES = 32;
const ACCESS_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHARE_GRANT_TTL_SECONDS = 10 * 60;
export const CURRENT_SHARE_ACCESS_KEY_VERSION = 1;

export function createShareAccessKey(): string {
  const bytes = new Uint8Array(ACCESS_KEY_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function hashShareAccessKey(accessKey: string, env: ShareAccessEnv): Promise<string> {
  requireShareAccessSecrets(env);
  return hashText(accessKey, env.SHARE_ACCESS_PEPPER_V1);
}

export async function verifyShareAccessKey(
  providedAccessKey: unknown,
  expectedHash: string | null,
  accessKeyVersion: number | null,
  env: ShareAccessEnv
): Promise<boolean> {
  const candidate = typeof providedAccessKey === "string" ? providedAccessKey.slice(0, 256) : "";
  const candidateHash = await hashShareAccessKey(candidate, env);
  const comparisonHash = expectedHash ?? "0".repeat(64);
  const hashesMatch = timingSafeEqualBytes(
    new TextEncoder().encode(candidateHash),
    new TextEncoder().encode(comparisonHash)
  );
  return ACCESS_KEY_PATTERN.test(candidate) &&
    expectedHash !== null &&
    accessKeyVersion === CURRENT_SHARE_ACCESS_KEY_VERSION &&
    hashesMatch;
}

export async function createPreviewGrant(
  share: ShareRecord,
  env: ShareAccessEnv,
  now = Date.now()
): Promise<string> {
  return createShareGrant(share, "preview", env, now);
}

export async function createMetadataGrant(
  share: ShareRecord,
  env: ShareAccessEnv,
  now = Date.now()
): Promise<string> {
  return createShareGrant(share, "metadata", env, now);
}

async function createShareGrant(
  share: ShareRecord,
  audience: ShareGrantAudience,
  env: ShareAccessEnv,
  now: number
): Promise<string> {
  if (
    share.visibility !== "private_link" ||
    !share.access_key_hash ||
    share.access_key_version !== CURRENT_SHARE_ACCESS_KEY_VERSION
  ) {
    throw new Error("A share grant can only be created for a private share.");
  }

  const payload: ShareGrant = {
    shareId: share.id,
    slug: share.slug,
    audience,
    expiresAt: Math.floor(now / 1000) + SHARE_GRANT_TTL_SECONDS,
  };
  const encodedPayload = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(
    `${encodedPayload}.${share.access_key_hash}`,
    signingKeyForVersion(env, share.access_key_version)
  );
  return `${encodedPayload}.${base64Url(signature)}`;
}

export async function verifyPreviewGrant(
  grant: string | null,
  share: ShareRecord,
  env: ShareAccessEnv,
  now = Date.now()
): Promise<boolean> {
  return verifyShareGrant(grant, share, "preview", env, now);
}

export async function verifyMetadataGrant(
  grant: string | null,
  share: ShareRecord,
  env: ShareAccessEnv,
  now = Date.now()
): Promise<boolean> {
  return verifyShareGrant(grant, share, "metadata", env, now);
}

async function verifyShareGrant(
  grant: string | null,
  share: ShareRecord,
  audience: ShareGrantAudience,
  env: ShareAccessEnv,
  now: number
): Promise<boolean> {
  if (
    !grant ||
    share.visibility !== "private_link" ||
    !share.access_key_hash ||
    share.access_key_version !== CURRENT_SHARE_ACCESS_KEY_VERSION
  ) return false;

  const parts = grant.split(".");
  if (parts.length !== 2) return false;
  const [encodedPayload, encodedSignature] = parts;

  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = decodeBase64Url(encodedSignature);
  } catch {
    return false;
  }

  const key = await importHmacKey(signingKeyForVersion(env, share.access_key_version), ["verify"]);
  const signatureValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(`${encodedPayload}.${share.access_key_hash}`)
  );
  if (!signatureValid) return false;

  let payload: ShareGrant;
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as ShareGrant;
  } catch {
    return false;
  }

  if (
    payload.shareId !== share.id ||
    payload.slug !== share.slug ||
    payload.audience !== audience ||
    typeof payload.expiresAt !== "number" ||
    payload.expiresAt <= Math.floor(now / 1000)
  ) {
    return false;
  }
  return true;
}

export function previewGrantCookieName(slug: string): string {
  return `share_access_${slug}`;
}

export function previewGrantCookie(slug: string, grant: string, request: Request): string {
  return grantCookie(previewGrantCookieName(slug), `/v/${slug}`, grant, request);
}

export function metadataGrantCookieName(slug: string): string {
  return `share_metadata_${slug}`;
}

export function metadataGrantCookie(slug: string, grant: string, request: Request): string {
  return grantCookie(
    metadataGrantCookieName(slug),
    `/api/shares/${slug}/access`,
    grant,
    request
  );
}

function grantCookie(name: string, path: string, grant: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return [
    `${name}=${grant}`,
    `Path=${path}`,
    `Max-Age=${SHARE_GRANT_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
  ].join("; ") + secure;
}

export function readPreviewGrant(request: Request, slug: string): string | null {
  return readCookie(request, previewGrantCookieName(slug));
}

export function readMetadataGrant(request: Request, slug: string): string | null {
  return readCookie(request, metadataGrantCookieName(slug));
}

function readCookie(request: Request, cookieName: string): string | null {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator === -1) continue;
    if (cookie.slice(0, separator).trim() === cookieName) {
      return cookie.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

async function sign(value: string, secret: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(left, right);
  }

  // Node's Web Crypto lacks the Workers extension. This fixed-length fallback
  // is only used by the local Node test runtime; production Workers use the
  // platform timingSafeEqual implementation above.
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function signingKeyForVersion(env: ShareAccessEnv, version: number): string {
  requireShareAccessSecrets(env);
  if (version === CURRENT_SHARE_ACCESS_KEY_VERSION) return env.PREVIEW_GRANT_SIGNING_KEY_V1;
  throw new Error(`Unsupported share access key version: ${version}`);
}

function requireShareAccessSecrets(env: ShareAccessEnv): void {
  if (!env.SHARE_ACCESS_PEPPER_V1 || !env.PREVIEW_GRANT_SIGNING_KEY_V1) {
    throw new Error("SHARE_ACCESS_PEPPER_V1 and PREVIEW_GRANT_SIGNING_KEY_V1 must be configured.");
  }
}
