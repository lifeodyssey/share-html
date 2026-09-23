import { marketingPageForPath } from "../shared/marketing.ts";

export type AnalyticsEnv = {
  ANALYTICS_ENABLED?: string;
  SUPABASE_URL: string;
  SUPABASE_REST_KEY: string;
  WORKER_API_SECRET: string;
};
export type Transport = "browser" | "http_api" | "mcp" | "webmcp";
export type Acquisition = { source?: string; medium?: string; campaign?: string; referrer_domain?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const token = /^[a-z0-9_-]{1,64}$/;
const webMcpEvents = new Set(["webmcp_available", "webmcp_registered", "webmcp_call", "webmcp_result"]);
const webMcpTools = new Set(["create_share", "get_public_share", "describe_share_html", "access_private_share"]);
const browserEvents = new Set(["page_view", "upload_started", "upload_failed", "share_link_copied"]);
const discoveryPaths = new Set(["/llms.txt", "/robots.txt", "/sitemap.xml", "/openapi.json", "/server.json", "/auth.md", "/.well-known/api-catalog", "/.well-known/oauth-protected-resource", "/.well-known/openid-configuration", "/.well-known/oauth-authorization-server", "/.well-known/mcp/server-card.json", "/.well-known/webmcp.json", "/.well-known/agent-skills/index.json", "/.well-known/agent-skills/share-html/SKILL.md", "/.well-known/security.txt", "/.well-known/auth.md", "/.well-known/agent-card.json", "/.well-known/agent.json"]);
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function normalizeRoute(raw: unknown): string {
  if (typeof raw !== "string") return "other";
  const path = raw.split(/[?#]/, 1)[0];
  if (/^\/s\/[^/]+\/?$/.test(path)) return "/s/:slug";
  if (/^\/v\/[^/]+(?:\/.*)?$/.test(path)) return "/v/:slug";
  if (path === "/" || path === "/mcp" || path === "/api/shares" || discoveryPaths.has(path) || marketingPageForPath(path)) return path;
  return "other";
}
export function sanitizeAcquisition(input: unknown): Acquisition {
  const value = record(input);
  const safe: Acquisition = {};
  for (const key of ["source", "medium", "campaign"] as const) {
    if (typeof value[key] === "string" && token.test(value[key])) safe[key] = value[key];
  }
  const domain = value.referrer_domain;
  if (typeof domain === "string" && domain.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) safe.referrer_domain = domain.toLowerCase();
  return safe;
}
export function parseUploadAnalytics(input: unknown): { session_id?: string; acquisition?: Acquisition } {
  if (typeof input !== "string" || input.length > 2048) return {};
  try {
    const value = record(JSON.parse(input));
    return { session_id: typeof value.session_id === "string" && uuid.test(value.session_id) ? value.session_id : undefined, acquisition: sanitizeAcquisition(value.acquisition) };
  } catch { return {}; }
}
// ISO 3166-1 alpha-2 plus Cloudflare's Kosovo code; ZZ is unknown.
const countryCodes = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW ZZ".split(" "));
export function countryCode(request: Request): string {
  const country = record((request as Request & { cf?: unknown }).cf).country;
  return typeof country === "string" && countryCodes.has(country) ? country : "ZZ";
}

export function classifyActor(request: Request) {
  const cf = record((request as Request & { cf?: unknown }).cf);
  const bot_verified = record(cf.botManagement).verifiedBot === true;
  const ua = request.headers.get("user-agent") ?? "";
  const rules = [[/OAI-SearchBot|Claude-SearchBot|PerplexityBot|xAI-SearchBot/i, "ai_search"], [/GPTBot|ClaudeBot|Google-Extended|CCBot|Bytespider/i, "ai_training"], [/ChatGPT-User|Claude-User|Perplexity-User/i, "ai_user_fetch"], [/bot|crawler|spider|curl|wget|python|node|headless|playwright/i, "automation"]] as const;
  for (const [pattern, category] of rules) if (pattern.test(ua)) return { actor_category: category, actor_evidence: "ua_self_reported", bot_verified };
  if (bot_verified) return { actor_category: "verified_bot", actor_evidence: "cloudflare_verified", bot_verified };
  if (/Mozilla\//.test(ua)) return { actor_category: "browser_unknown", actor_evidence: "ua_self_reported", bot_verified };
  return { actor_category: "unknown", actor_evidence: "unknown", bot_verified };
}
export function acquisitionCategory(a: Acquisition): string {
  if (a.source || a.medium || a.campaign) return "tagged";
  if (a.referrer_domain && /(^|\.)(chatgpt\.com|chat\.openai\.com|claude\.ai|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/.test(a.referrer_domain)) return "ai_referral";
  if (a.referrer_domain && /(^|\.)google\.(?:com|cat|[a-z]{2}|(?:com|co)\.[a-z]{2})$/.test(a.referrer_domain)) return "google";
  return "direct_or_unknown";
}
export type EventInput = {
  event_name: string; transport: Transport; route?: string; event_id?: string; session_id?: string;
  acquisition?: Acquisition; status?: number; outcome?: string; legacy_source?: string;
  mcp_method?: string; mcp_tool?: string; mcp_client?: string;
};
export function buildEvent(request: Request, input: EventInput) {
  let referrer_domain: string | undefined;
  try { referrer_domain = new URL(request.headers.get("referer") ?? "").hostname; } catch { /* No referrer is unknown acquisition. */ }
  const acquisition = sanitizeAcquisition(input.acquisition ?? { referrer_domain });
  return {
    event_id: input.event_id ?? crypto.randomUUID(), event_name: input.event_name,
    traffic_type: /ShareHTML-(?:Research|Validation)(?:[\/\s]|$)/i.test(request.headers.get("user-agent") ?? "") || [input.legacy_source, acquisition.source].some(source => source === "internal_validation" || source === "internal_research") ? "internal" : "production",
    session_id: input.session_id && uuid.test(input.session_id) ? input.session_id : null,
    route: normalizeRoute(input.route ?? new URL(request.url).pathname), transport: input.transport,
    ...classifyActor(request), country_code: countryCode(request), acquisition_category: acquisitionCategory(acquisition), acquisition,
    acquisition_evidence: input.acquisition ? "client_self_reported" : "referer_self_reported",
    status: input.status ?? null, outcome: input.outcome ?? null,
    legacy_source: input.legacy_source && token.test(input.legacy_source) ? input.legacy_source : null,
    mcp_method: input.mcp_method ?? null, mcp_tool: input.mcp_tool ?? null, mcp_client: input.mcp_client ?? null,
  };
}
export async function analyticsRpc(env: AnalyticsEnv, name: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: env.SUPABASE_REST_KEY, authorization: `Bearer ${env.SUPABASE_REST_KEY}`, "x-worker-secret": env.WORKER_API_SECRET, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("analytics_write_failed");
  return response.json();
}
export function trackEvent(request: Request, env: AnalyticsEnv, ctx: ExecutionContext, input: EventInput): void {
  if (env.ANALYTICS_ENABLED !== "true") return;
  ctx.waitUntil(analyticsRpc(env, "record_analytics_event", { payload: buildEvent(request, input) }).catch(() => {
    console.warn(JSON.stringify({ event: "analytics_write_failed" }));
  }));
}
async function boundedJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > 4096) throw new Error("too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_body");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new Error("too_large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function ingestBrowserEvent(request: Request, env: AnalyticsEnv): Promise<Response> {
  const reply = (status: number) => new Response(null, { status, headers: { "cache-control": "no-store" } });
  if (env.ANALYTICS_ENABLED !== "true") return reply(204);
  if (request.method !== "POST") return reply(405);
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply(403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") return reply(415);
  let value: Record<string, unknown>;
  try { value = record(await boundedJson(request)); } catch (e) { return reply(e instanceof Error && e.message === "too_large" ? 413 : 400); }
  if (typeof value.event !== "string" || (!browserEvents.has(value.event) && !webMcpEvents.has(value.event)) || typeof value.event_id !== "string" || !uuid.test(value.event_id) || typeof value.session_id !== "string" || !uuid.test(value.session_id) || typeof value.route !== "string" || value.route.length > 512 || (value.acquisition !== undefined && (value.acquisition === null || typeof value.acquisition !== "object" || Array.isArray(value.acquisition)))) return reply(400);
  const webMcp = webMcpEvents.has(value.event);
  if (webMcp) {
    const toolEvent = value.event === "webmcp_call" || value.event === "webmcp_result";
    if (value.transport !== "webmcp" || (toolEvent && (typeof value.tool !== "string" || !webMcpTools.has(value.tool))) ||
      (!toolEvent && value.tool !== undefined) ||
      (value.event === "webmcp_call" ? value.outcome !== null : value.outcome !== "success" && value.outcome !== "failure")) return reply(400);
  } else if (value.transport !== undefined && value.transport !== "browser") return reply(400);
  // Abuse-only daily rotating hash; never enters event rows or reports. No person identity inference.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.WORKER_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${new Date().toISOString().slice(0, 10)}:${ip}`));
  const abuseKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  try {
    const result = await analyticsRpc(env, "ingest_browser_analytics", { payload: buildEvent(request, { event_name: value.event, event_id: value.event_id, session_id: value.session_id, route: value.route, acquisition: sanitizeAcquisition(value.acquisition), transport: webMcp ? "webmcp" : "browser", ...(webMcp ? { outcome: typeof value.outcome === "string" ? value.outcome : undefined, mcp_tool: typeof value.tool === "string" ? value.tool : undefined, legacy_source: "webmcp" } : {}) }), abuse_key: abuseKey });
    return reply(result === true ? 204 : 429);
  } catch { return reply(503); }
}
