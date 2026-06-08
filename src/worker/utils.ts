export { base64Url } from "./db.ts";

export function cleanTitle(value: FormDataEntryValue | null, html: string): string {
  const explicit = sanitizeShortText(typeof value === "string" ? value : "", 120);
  if (explicit) return explicit;
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return sanitizeShortText(match?.[1] ?? "Untitled HTML", 120) || "Untitled HTML";
}

export function sanitizeShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function looksLikeHtml(html: string): boolean {
  const sample = html.slice(0, 2048).toLowerCase();
  return sample.includes("<!doctype html") || sample.includes("<html") || /<body[\s>]/i.test(sample) || /<script[\s>]/i.test(sample);
}

export function isUploadFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "size" in value && "name" in value;
}

export function getClientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashText(value: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${value}`);
}

export function numberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} bytes`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      default: return "&#039;";
    }
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function logBackgroundError(error: unknown): void {
  console.error(JSON.stringify({ event: "background_error", message: errorMessage(error) }));
}
