import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  vi.resetModules(); localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, "", "/");
  Object.defineProperty(document, "referrer", { configurable: true, value: "" });
  Object.defineProperty(navigator, "modelContext", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "0" });
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});
afterEach(() => vi.unstubAllGlobals());
async function enable() {
  const analytics = await import("../../src/client/analytics");
  analytics.configureAnalytics({ analyticsEnabled: true, ga4MeasurementId: "G-TEST1234" });
  analytics.setAnalyticsConsent("granted"); return analytics;
}
function events() {
  return vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/analytics/events").map(([, init]) => JSON.parse(String(init?.body)));
}
test("WebMCP registration and tool behavior stay available without analytics consent", async () => {
  const provideContext = vi.fn(); Object.defineProperty(navigator, "modelContext", { value: { provideContext } });
  const { provideShareHtmlContext } = await import("../../src/client/webmcp");
  await provideShareHtmlContext();
  const tools = provideContext.mock.calls[0][0].tools;
  expect(tools.map((tool: {name:string}) => tool.name)).toEqual(["describe_share_html", "get_public_share", "access_private_share", "create_share"]);
  const result = await tools[0].execute({}); expect(result.content[0].text).toContain("Share HTML");
  expect(fetch).not.toHaveBeenCalled();
});
test("consent granted after registration reports availability and registration once", async () => {
  Object.defineProperty(navigator, "modelContext", { value: { provideContext: vi.fn() } });
  const { provideShareHtmlContext, reportWebMcpState } = await import("../../src/client/webmcp");
  await provideShareHtmlContext(); expect(events()).toEqual([]);
  await enable(); reportWebMcpState(); reportWebMcpState();
  expect(events().map(event => [event.event,event.outcome,event.transport])).toEqual([["webmcp_available","success","webmcp"],["webmcp_registered","success","webmcp"]]);
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
});
test("unavailable browser and registration rejection are explicit observations", async () => {
  await enable(); const module = await import("../../src/client/webmcp");
  await module.provideShareHtmlContext(); expect(events()[0].outcome).toBe("failure");
  Object.defineProperty(navigator, "modelContext", { value: { provideContext: () => { throw new Error("private registration details"); } } });
  await expect(module.provideShareHtmlContext()).rejects.toThrow("private registration details");
  expect(events().at(-1)).toMatchObject({event:"webmcp_registered",outcome:"failure"});
  expect(JSON.stringify(events())).not.toContain("private registration details");
});
test("tool validation, successful result and network failure are observed without arguments or errors", async () => {
  await enable(); const { webMcpTools, instrumentWebMcpTool } = await import("../../src/client/webmcp");
  const create = instrumentWebMcpTool(webMcpTools().find(tool => tool.name === "create_share")!);
  expect((await create.execute({})).isError).toBe(true);
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (url === "/api/shares") throw new Error("secret-key-and-content");
    return new Response(null, { status: 204 });
  });
  await expect(create.execute({html:"<html>private content</html>",title:"private title"})).rejects.toThrow("secret-key-and-content");
  const describe = instrumentWebMcpTool(webMcpTools()[0]); await describe.execute({});
  expect(events().map(event => [event.event,event.outcome])).toEqual([
    ["webmcp_call",null],["webmcp_result","failure"],
    ["webmcp_call",null],["webmcp_result","failure"],
    ["webmcp_call",null],["webmcp_result","success"],
  ]);
  expect(JSON.stringify(events())).not.toMatch(/private|secret-key|html>|title/);
});
test.each(["denied","dnt","gpc"])("%s suppresses optional WebMCP telemetry on every invocation", async (signal) => {
  const analytics = await enable(); const { webMcpTools, instrumentWebMcpTool } = await import("../../src/client/webmcp");
  if(signal === "denied") analytics.setAnalyticsConsent("denied");
  if(signal === "dnt") Object.defineProperty(navigator,"doNotTrack",{value:"1"});
  if(signal === "gpc") Object.defineProperty(navigator,"globalPrivacyControl",{value:true});
  await instrumentWebMcpTool(webMcpTools()[0]).execute({}); expect(events()).toEqual([]);
});
test("private access tool returns original response while telemetry contains only normalized route and tool name", async () => {
  await enable(); window.history.replaceState({}, "", "/s/private-slug#key=private-key");
  vi.mocked(fetch).mockImplementation(async (url) => url === "/api/analytics/events" ? new Response(null,{status:204}) : new Response('{"private":"metadata"}',{status:403}));
  const { webMcpTools, instrumentWebMcpTool } = await import("../../src/client/webmcp");
  const result = await instrumentWebMcpTool(webMcpTools()[2]).execute({slug:"private-slug",accessKey:"private-key"});
  expect(result.isError).toBe(true);
  expect(events()[0]).toMatchObject({route:"/s/:slug",tool:"access_private_share"});
  expect(JSON.stringify(events())).not.toMatch(/private-slug|private-key|metadata/);
});
test("create_share keeps multipart source and returned content unchanged while emitting success", async () => {
  await enable();
  vi.mocked(fetch).mockImplementation(async (url) => url === "/api/analytics/events" ? new Response(null,{status:204}) : new Response('{"share":"original-result"}',{status:201}));
  const { webMcpTools, instrumentWebMcpTool } = await import("../../src/client/webmcp");
  const result=await instrumentWebMcpTool(webMcpTools()[3]).execute({html:"<html>hello</html>",title:"private title",visibility:"private_link"});
  const upload=vi.mocked(fetch).mock.calls.find(([url])=>url==="/api/shares");
  const form=upload?.[1]?.body as FormData;
  expect(form.get("source")).toBe("webmcp"); expect(form.get("title")).toBe("private title"); expect(form.get("visibility")).toBe("private_link");
  expect(result).toEqual({content:[{type:"text",text:'{"share":"original-result"}'}],isError:false});
  expect(events().at(-1)).toMatchObject({event:"webmcp_result",outcome:"success",tool:"create_share"});
});
test("consented WebMCP creation joins only sanitized tab context to the server upload", async () => {
  window.history.replaceState({}, "", "/?utm_source=claude&utm_medium=agent&utm_campaign=launch&accessKey=secret#private-fragment");
  Object.defineProperty(document,"referrer",{configurable:true,value:"https://claude.ai/chat/private-conversation?token=secret"});
  await enable();
  vi.mocked(fetch).mockResolvedValue(new Response('{"ok":true}',{status:201}));
  const { webMcpTools, instrumentWebMcpTool } = await import("../../src/client/webmcp");
  const result=await instrumentWebMcpTool(webMcpTools()[3]).execute({html:"<html>private document</html>",title:"private title",accessKey:"secret-key"});
  const upload=vi.mocked(fetch).mock.calls.find(([url])=>url==="/api/shares");
  const context=JSON.parse(String((upload?.[1]?.body as FormData).get("analytics")));
  expect(Object.keys(context).sort()).toEqual(["acquisition","session_id"]);
  expect(context.acquisition).toEqual({source:"claude",medium:"agent",campaign:"launch",referrer_domain:"claude.ai"});
  expect(context.session_id).toBe(events()[0].session_id);
  expect(JSON.stringify(context)).not.toMatch(/secret|private|document|title|fragment|conversation/);
  expect(result).toEqual({content:[{type:"text",text:'{"ok":true}'}],isError:false});
});
test.each(["absent","denied","dnt","gpc"])("%s WebMCP creation omits analytics form context",async(signal)=>{
  const analytics=await enable();
  if(signal==="absent") localStorage.clear();
  if(signal==="denied") analytics.setAnalyticsConsent("denied");
  if(signal==="dnt") Object.defineProperty(navigator,"doNotTrack",{value:"1"});
  if(signal==="gpc") Object.defineProperty(navigator,"globalPrivacyControl",{value:true});
  vi.mocked(fetch).mockResolvedValue(new Response('{}',{status:201}));
  const { webMcpTools }=await import("../../src/client/webmcp");
  await webMcpTools()[3].execute({html:"<html>hello</html>"});
  const upload=vi.mocked(fetch).mock.calls.find(([url])=>url==="/api/shares");
  expect((upload?.[1]?.body as FormData).has("analytics")).toBe(false);
});
