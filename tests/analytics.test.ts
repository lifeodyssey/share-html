import { afterEach, test, expect, vi } from "vitest";
import { acquisitionCategory, buildEvent, classifyActor, ingestBrowserEvent, normalizeRoute, parseUploadAnalytics, trackEvent } from "../src/worker/analytics.ts";
const env = { ANALYTICS_ENABLED: "true", SUPABASE_URL: "https://db.example", SUPABASE_REST_KEY: "key", WORKER_API_SECRET: "secret" };
const valid = { event: "page_view", event_id: "aab11f0d-0baa-417b-8271-620fa97ef198", session_id: "bab11f0d-0baa-417b-8271-620fa97ef198", route: "/s/private-slug#key=secret" };
function request(body: unknown = valid, headers: Record<string,string> = {}) { return new Request("https://app.example/api/analytics/events", {method:"POST",headers:{origin:"https://app.example","content-type":"application/json",...headers},body:JSON.stringify(body)}); }
afterEach(() => vi.restoreAllMocks());
test("privacy: route and referral path, key, UA and IP never enter event payload", () => {
 const r = new Request("https://app.example/v/secret-slug?key=topsecret",{headers:{"user-agent":"ChatGPT-User private text",referer:"https://chatgpt.com/c/private-conversation?token=secret","cf-connecting-ip":"1.2.3.4"}});
 const value = buildEvent(r,{event_name:"preview_served",transport:"http_api"});
 expect(value.route).toBe("/v/:slug"); expect(value.acquisition).toEqual({referrer_domain:"chatgpt.com"});
 expect(value.actor_category).toBe("ai_user_fetch"); expect(value.actor_evidence).toBe("ua_self_reported");
 expect(JSON.stringify(value)).not.toMatch(/secret|private|1\.2\.3\.4|ChatGPT-User/);
});
test("legacy source never establishes MCP transport or verified actor identity", () => {
 const value = buildEvent(new Request("https://app.example/api/shares"),{event_name:"share_created",transport:"http_api",legacy_source:"mcp"});
 expect(value.transport).toBe("http_api"); expect(value.actor_category).toBe("unknown");
 expect(classifyActor(new Request("https://app.example",{headers:{"cf-verified-bot":"true","user-agent":"GPTBot"}})).actor_evidence).toBe("ua_self_reported");
});
test("Cloudflare object verification is separate from user agent heuristics",()=>{
 const r=new Request("https://app.example"); Object.defineProperty(r,"cf",{value:{botManagement:{verifiedBot:true}}});
 expect(classifyActor(r)).toEqual({actor_category:"verified_bot",actor_evidence:"cloudflare_verified",bot_verified:true});
 r.headers.set("user-agent", "OAI-SearchBot");
 expect(classifyActor(r)).toEqual({actor_category:"ai_search",actor_evidence:"ua_self_reported",bot_verified:true});
});
test("malformed attribution is dropped and unknown routes are bounded",()=>{
 expect(parseUploadAnalytics('{bad')).toEqual({}); expect(normalizeRoute('/arbitrary/secret')).toBe('other');
 expect(parseUploadAnalytics(JSON.stringify({session_id:'private',acquisition:{source:'https://secret',referrer_domain:'host.example/path',campaign:'safe_tag',private:'secret'}}))).toEqual({session_id:undefined,acquisition:{campaign:'safe_tag'}});
});
test("ingest requires same-origin JSON, UUIDs, types and bounded streamed body",async()=>{
 const f=vi.spyOn(globalThis,'fetch');
 expect((await ingestBrowserEvent(request(valid,{origin:'https://evil.example'}),env)).status).toBe(403);
 expect((await ingestBrowserEvent(request(valid,{'content-type':'text/plain'}),env)).status).toBe(415);
 expect((await ingestBrowserEvent(request({...valid,session_id:'bad'}),env)).status).toBe(400);
 expect((await ingestBrowserEvent(request({...valid,acquisition:[]}),env)).status).toBe(400);
 expect((await ingestBrowserEvent(request({...valid,extra:'x'.repeat(5000)}),env)).status).toBe(413);
 expect(f).not.toHaveBeenCalled();
});
test("ingest sends no raw IP to atomic rate-limited RPC and reports rejection",async()=>{
 const f=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('true'));
 expect((await ingestBrowserEvent(request(valid,{'cf-connecting-ip':'1.2.3.4'}),env)).status).toBe(204);
 const body=JSON.parse(String(f.mock.calls[0][1]?.body));
 expect(body.abuse_key).toMatch(/^[0-9a-f]{64}$/); expect(body.payload.route).toBe('/s/:slug');
 expect(JSON.stringify(body)).not.toMatch(/1\.2\.3\.4|secret/);
 f.mockResolvedValue(new Response('false'));
 expect((await ingestBrowserEvent(request(),env)).status).toBe(429);
 f.mockResolvedValue(new Response('unavailable',{status:500}));
 expect((await ingestBrowserEvent(request(),env)).status).toBe(503);
});
test("disabled telemetry is fail-closed and background failures never reject business work",async()=>{
 const f=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('secret error')); const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const jobs:Promise<unknown>[]=[];const ctx={waitUntil:(p:Promise<unknown>)=>jobs.push(p)} as ExecutionContext;
 trackEvent(request(),{...env,ANALYTICS_ENABLED:undefined},ctx,{event_name:'share_created',transport:'http_api'}); expect(f).not.toHaveBeenCalled();
 trackEvent(request(),env,ctx,{event_name:'share_create_failed',transport:'http_api',status:500}); await Promise.all(jobs);
 expect(warn).toHaveBeenCalledWith('{"event":"analytics_write_failed"}');
});
test("internal traffic is only an explicit self-reported marker, never inferred from the owner",()=>{
 const ordinary=buildEvent(new Request("https://app.example"),{event_name:"share_created",transport:"http_api"});
 expect(ordinary.traffic_type).toBe("production");
 const labeled=buildEvent(new Request("https://app.example",{headers:{"user-agent":"ShareHTML-Validation/1"}}),{event_name:"share_created",transport:"http_api"});
 expect(labeled.traffic_type).toBe("internal");
 expect(buildEvent(new Request("https://app.example"),{event_name:"share_created",transport:"http_api",legacy_source:"internal_validation"}).traffic_type).toBe("internal");
});
test("search and AI attribution does not trust lookalike referrer domains", () => {
 expect(acquisitionCategory({referrer_domain:"www.google.co.jp"})).toBe("google");
 expect(acquisitionCategory({referrer_domain:"google.example.com"})).toBe("direct_or_unknown");
 expect(acquisitionCategory({referrer_domain:"chatgpt.com"})).toBe("ai_referral");
 expect(acquisitionCategory({referrer_domain:"chatgpt.com.example.com"})).toBe("direct_or_unknown");
 expect(acquisitionCategory({referrer_domain:"gemini.google.com"})).toBe("ai_referral");
});
test("WebMCP browser observations retain separate self-reported transport and allowlisted tool outcome", async () => {
  const f=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("true"));
  const body={...valid,event:"webmcp_result",transport:"webmcp",outcome:"failure",tool:"access_private_share",args:{accessKey:"secret"},error:"secret"};
  expect((await ingestBrowserEvent(request(body),env)).status).toBe(204);
  const payload=JSON.parse(String(f.mock.calls[0][1]?.body)).payload;
  expect(payload).toMatchObject({event_name:"webmcp_result",transport:"webmcp",mcp_tool:"access_private_share",outcome:"failure",legacy_source:"webmcp",mcp_method:null,mcp_client:null});
  expect(JSON.stringify(payload)).not.toContain("secret");
});
test.each([
 {event:"webmcp_call",transport:"mcp",tool:"create_share",outcome:null},
 {event:"webmcp_result",transport:"webmcp",tool:"private-arbitrary-tool",outcome:"success"},
 {event:"webmcp_available",transport:"webmcp",tool:"create_share",outcome:"success"},
 {event:"webmcp_result",transport:"webmcp",tool:"create_share",outcome:"arbitrary"},
 {event:"webmcp_call",transport:"webmcp",tool:"create_share",outcome:"success"},
 {event:"page_view",transport:"webmcp"},
])("invalid WebMCP combination is rejected %j",async(extra)=>{
 const f=vi.spyOn(globalThis,"fetch"); expect((await ingestBrowserEvent(request({...valid,...extra}),env)).status).toBe(400); expect(f).not.toHaveBeenCalled();
});
test("early HTTP file validation preserves a WebMCP source without changing transport", async () => {
  const { createShare } = await import("../src/worker/shares.ts");
  const f=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("true"));
  const form=new FormData(); form.set("source","webmcp");
  const jobs:Promise<unknown>[]=[];
  const response=await createShare(new Request("https://app.example/api/shares",{method:"POST",body:form}),env as Parameters<typeof createShare>[1],{waitUntil:(job:Promise<unknown>)=>jobs.push(job)} as ExecutionContext);
  await Promise.all(jobs);
  expect(response.status).toBe(422);
  expect(JSON.parse(String(f.mock.calls[0][1]?.body)).payload).toMatchObject({event_name:"share_create_failed",legacy_source:"webmcp",transport:"http_api",status:422});
});
test.each(["US","TW","HK","XK","ZZ"])("country dimension accepts Cloudflare country %s without granular location",country=>{
 const request=new Request("https://app.example",{headers:{"cf-ipcountry":"DE"}});
 Object.defineProperty(request,"cf",{value:{country,city:"private city",latitude:"22.123",longitude:"113.123",postalCode:"private postal",colo:"private colo"}});
 const event=buildEvent(request,{event_name:"page_served",transport:"http_api"});
 expect(event.country_code).toBe(country);
 expect(JSON.stringify(event)).not.toMatch(/private|22\.123|113\.123/);
});
test.each([undefined,null,"us","XX","QZ","T1","USA",123,{},"US?token=secret"])("invalid/missing Cloudflare country is ZZ, ignoring forged headers: %j",country=>{
 const request=new Request("https://app.example",{headers:{"cf-ipcountry":"US","x-country":"JP"}});
 Object.defineProperty(request,"cf",{value:{country}});
 expect(buildEvent(request,{event_name:"page_served",transport:"http_api"}).country_code).toBe("ZZ");
});
test("browser cannot override country using submitted telemetry fields",async()=>{
 const f=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("true"));
 const req=request({...valid,country_code:"US",country:"US"});
 Object.defineProperty(req,"cf",{value:{country:"TW"}});
 expect((await ingestBrowserEvent(req,env)).status).toBe(204);
 expect(JSON.parse(String(f.mock.calls[0][1]?.body)).payload.country_code).toBe("TW");
});
