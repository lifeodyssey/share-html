import type { RiskReason } from "../shared/types.ts";

export type ScanResult = {
  score: number;
  status: "clean" | "suspicious" | "blocked";
  lifecycle: "active" | "needs_review" | "blocked";
  reasons: RiskReason[];
  urls: string[];
};

const SHORT_LINK_HOSTS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "buff.ly"];

export function scanHtml(html: string): ScanResult {
  const reasons: RiskReason[] = [];
  const urls = Array.from(html.matchAll(/https?:\/\/[^\s"'<>`)]+/gi)).map((match) => match[0]);
  const lower = html.toLowerCase();

  addReasonIf(reasons, /<form[^>]+action=["']https?:\/\//i.test(html) && /type=["']password["']/i.test(html), "external_password_form", 40, "Password form posts to an external origin.");
  addReasonIf(reasons, /\b(seed phrase|private key|recovery phrase|wallet connect|metamask|phantom wallet)\b/i.test(html), "wallet_keywords", 25, "Contains wallet or seed phrase language.");
  addReasonIf(reasons, /\b(window|parent|top)\.location\b|\blocation\.(href|replace|assign)\b/i.test(html), "top_navigation_attempt", 20, "Contains JavaScript navigation code.");
  addReasonIf(reasons, /<base[^>]+href=["']https?:\/\//i.test(html), "external_base_href", 20, "Contains an external base URL.");
  addReasonIf(reasons, /http:\/\//i.test(html), "mixed_content", 15, "References non-HTTPS resources.");
  addReasonIf(reasons, SHORT_LINK_HOSTS.some((host) => lower.includes(host)), "short_link_reference", 15, "References a common short-link host.");
  addReasonIf(reasons, /<iframe[^>]+src=["']https?:\/\//i.test(html) && /login|signin|wallet|verify/i.test(html), "suspicious_iframe", 20, "Embeds an external login-like frame.");

  const score = Math.min(100, reasons.reduce((sum, reason) => sum + reason.weight, 0));
  if (score >= 80) return { score, status: "blocked", lifecycle: "blocked", reasons, urls };
  if (score >= 50) return { score, status: "suspicious", lifecycle: "needs_review", reasons, urls };
  return { score, status: "clean", lifecycle: "active", reasons, urls };
}

function addReasonIf(reasons: RiskReason[], condition: boolean, code: string, weight: number, detail: string): void {
  if (condition) reasons.push({ code, weight, detail });
}
