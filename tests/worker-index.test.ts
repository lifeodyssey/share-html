import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import worker from "../src/worker/index.ts";

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <!-- share-html:seo:start -->
    <title>Share HTML</title>
    <!-- share-html:seo:end -->
  </head>
  <body>
    <div id="root">
      <!-- share-html:fallback:start -->
      <main>
        <h1>Share HTML — upload one HTML file, get a sandboxed shareable link</h1>
      </main>
      <!-- share-html:fallback:end -->
    </div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>`;

function makeEnv() {
  return {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_REST_KEY: "rest-key",
    WORKER_API_SECRET: "worker-secret",
    ASSETS: {
      fetch: vi.fn(async () => new Response(INDEX_HTML, {
        headers: { "content-type": "text/html" },
      })),
    },
  } as any;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeCtx() {
  return { waitUntil: vi.fn() } as any;
}

test("worker fetch: share SPA fallback does not expose homepage copy before React renders", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{
    id: "share-1",
    slug: "example",
    visibility: "public_unlisted",
    lifecycle_status: "active",
    deleted_at: null,
    expires_at: null,
  }]), {
    headers: { "content-type": "application/json" },
  })));
  const env = makeEnv();
  const response = await worker.fetch(
    new Request("https://sharehtml.zhenjia.dev/s/example"),
    env,
    makeCtx()
  );

  assert.equal(response.status, 200);
  const html = await response.text();

  assert.ok(html.includes("Loading share..."));
  assert.ok(!html.includes("Share HTML — upload one HTML file"));
  assert.ok(html.includes("window.__APP_CONFIG__"));
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet, noimageindex");
  assert.equal(response.headers.get("content-signal"), "search=no, ai-input=no, ai-train=no, use=immediate");
});

test("worker fetch: homepage SPA fallback keeps agent-readable static copy", async () => {
  const env = makeEnv();
  const response = await worker.fetch(
    new Request("https://sharehtml.zhenjia.dev/"),
    env,
    makeCtx()
  );

  assert.equal(response.status, 200);
  const html = await response.text();

  assert.ok(html.includes("Share HTML — upload one HTML file"));
  assert.ok(!html.includes("Loading share..."));
  assert.ok(html.includes("window.__APP_CONFIG__"));
  assert.equal(response.headers.get("content-signal"), "search=yes, ai-input=yes, ai-train=no, use=reference");
});

test.each([
  ["/html-preview", "Turn one HTML file into a link people can open.", "Share an HTML Preview Online"],
  ["/private-html-sharing", "Share an HTML preview without making it publicly open.", "Private HTML Sharing"],
  ["/examples", "Start with a useful HTML file, not a blank page.", "Single-File HTML Examples"],
  ["/agents", "Give an agent HTML. Get back a shareable preview link.", "Share HTML for AI Agents"],
])("worker fetch: %s is crawlable with unique SSR content and metadata", async (path, heading, title) => {
  const response = await worker.fetch(
    new Request("https://sharehtml.zhenjia.dev" + path),
    makeEnv(),
    makeCtx()
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-signal"), "search=yes, ai-input=yes, ai-train=no, use=reference");
  assert.equal(response.headers.get("x-robots-tag"), null);
  const html = await response.text();
  assert.ok(html.includes(heading));
  assert.ok(html.includes("<title>" + title));
  assert.ok(html.includes('rel="canonical" href="https://sharehtml.zhenjia.dev' + path + '"'));
  assert.ok(html.includes('name="robots" content="index, follow, max-image-preview:large"'));
  assert.ok(!html.includes("Share HTML — upload one HTML file"));
});

test("worker fetch: serves downloadable example HTML without adding it to the index", async () => {
  const response = await worker.fetch(
    new Request("https://sharehtml.zhenjia.dev/examples/status-dashboard.html"),
    makeEnv(),
    makeCtx()
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
});

test("worker fetch: exposes and conditionally caches the standard A2A agent card", async () => {
  const first = await worker.fetch(
    new Request("https://sharehtml.zhenjia.dev/.well-known/agent-card.json"),
    makeEnv(),
    makeCtx()
  );
  const etag = first.headers.get("etag");
  assert.equal(first.status, 200);
  assert.equal(etag, '"share-html-a2a-1.0.0"');

  const second = await worker.fetch(
    new Request("https://sharehtml.zhenjia.dev/.well-known/agent-card.json", {
      headers: { "if-none-match": etag ?? "" },
    }),
    makeEnv(),
    makeCtx()
  );
  assert.equal(second.status, 304);
  assert.equal(await second.text(), "");

  for (const ifNoneMatch of [
    'W/"share-html-a2a-1.0.0"',
    '"another-tag", W/"share-html-a2a-1.0.0"',
    "*",
  ]) {
    const conditional = await worker.fetch(
      new Request("https://sharehtml.zhenjia.dev/.well-known/agent-card.json", {
        headers: { "if-none-match": ifNoneMatch },
      }),
      makeEnv(),
      makeCtx()
    );
    assert.equal(conditional.status, 304, ifNoneMatch);
  }

  const changed = await worker.fetch(
    new Request("https://sharehtml.zhenjia.dev/.well-known/agent-card.json", {
      headers: { "if-none-match": 'W/"different"' },
    }),
    makeEnv(),
    makeCtx()
  );
  assert.equal(changed.status, 200);
});

test("worker fetch: serves the MCP Registry manifest and an env-bound IndexNow key", async () => {
  const env = { ...makeEnv(), INDEXNOW_KEY: "IndexNowKey-12345678" };
  const manifest = await worker.fetch(
    new Request("https://sharehtml.zhenjia.dev/server.json"),
    env,
    makeCtx()
  );
  assert.equal(manifest.status, 200);
  assert.equal((await manifest.json() as any).name, "dev.zhenjia/share-html");

  const key = await worker.fetch(
    new Request("https://sharehtml.zhenjia.dev/IndexNowKey-12345678.txt"),
    env,
    makeCtx()
  );
  assert.equal(key.status, 200);
  assert.equal(await key.text(), "IndexNowKey-12345678");
  assert.equal(key.headers.get("cache-control"), "private, no-store");
  assert.equal(key.headers.get("content-signal"), "search=no, ai-input=no, ai-train=no, use=immediate");
  assert.equal(key.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet");
});

test.each([
  { lifecycle_status: "blocked", expires_at: null },
  { lifecycle_status: "uploading", expires_at: null },
  { lifecycle_status: "active", expires_at: "2020-01-01T00:00:00.000Z" },
])("worker fetch: private share shell does not leak lifecycle before key exchange", async (state) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{
    id: "share-private",
    slug: "private-example",
    visibility: "private_link",
    deleted_at: null,
    ...state,
  }]), {
    headers: { "content-type": "application/json" },
  })));
  const response = await worker.fetch(
    new Request("https://sharehtml.zhenjia.dev/s/private-example"),
    makeEnv(),
    makeCtx()
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("Loading share..."));
  assert.ok(!html.includes("expired"));
  assert.ok(!html.includes("blocked by moderation"));
  assert.ok(!html.includes("not ready"));
});

test("worker fetch: unknown browser route is a real noindex 404", async () => {
  const env = makeEnv();
  const response = await worker.fetch(
    new Request("https://sharehtml.zhenjia.dev/not-a-real-page"),
    env,
    makeCtx()
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet, noimageindex");
  const html = await response.text();
  assert.ok(html.includes("<h1>Not found</h1>"));
  assert.ok(!html.includes("Share HTML — upload one HTML file"));
});

test("worker report aliases redirect once and canonical folder goes unchanged to ASSETS", async () => {
  const env = makeEnv();
  env.ASSETS.fetch = vi.fn(async (request: Request) => {
    if (new URL(request.url).pathname.endsWith("index.html")) {
      return new Response(null, { status: 307, headers: { location: "/report/0923/" } });
    }
    return new Response("<!doctype html><title>Report</title>", { headers: { "content-type": "text/html" } });
  });
  for (const path of ["/report", "/report/0923", "/report/0923/index.html"]) {
    const response = await worker.fetch(new Request("https://sharehtml.zhenjia.dev" + path), env, makeCtx());
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/report/0923/");
  }
  const english = await worker.fetch(new Request("https://sharehtml.zhenjia.dev/report?lang=en"), env, makeCtx());
  assert.equal(english.headers.get("location"), "/report/0923/?lang=en");
  assert.equal(env.ASSETS.fetch.mock.calls.length, 0);
  const request = new Request("https://sharehtml.zhenjia.dev/report/0923/");
  const response = await worker.fetch(request, env, makeCtx());
  assert.equal(response.status, 200);
  assert.equal(env.ASSETS.fetch.mock.calls[0][0], request);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(response.headers.get("link"), '<https://sharehtml.zhenjia.dev/report/0923/>; rel="canonical"');
});

test("worker report serves aggregate JSON but rejects missing-asset SPA HTML fallback", async () => {
  const env = makeEnv();
  env.ASSETS.fetch = vi.fn(async (request: Request) => new URL(request.url).pathname.endsWith("data.json")
    ? new Response('{"count":2}', { headers: { "content-type": "application/json" } })
    : new Response(INDEX_HTML, { headers: { "content-type": "text/html" } }));
  const json = await worker.fetch(new Request("https://sharehtml.zhenjia.dev/report/0923/data.json"), env, makeCtx());
  assert.equal(json.status, 200);
  assert.deepEqual(await json.json(), { count: 2 });
  const missing = await worker.fetch(new Request("https://sharehtml.zhenjia.dev/report/0923/missing.csv"), env, makeCtx());
  assert.equal(missing.status, 404);
});

test.each(["/", "/agents", "/s/private-slug"])("page_served records successful HTML GET %s with independent UA evidence", async (path) => {
  const events: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("/rpc/record_analytics_event")) {
      events.push(JSON.parse(String(init?.body)).payload);
      return new Response("true", { headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify([{ id: "private-id", slug: "private-slug", visibility: "private_link", lifecycle_status: "active", deleted_at: null }]), { headers: { "content-type": "application/json" } });
  }));
  const env = { ...makeEnv(), ANALYTICS_ENABLED: "true" };
  const jobs: Promise<unknown>[] = [];
  const ctx = { waitUntil: (job: Promise<unknown>) => jobs.push(job) } as ExecutionContext;
  const response = await worker.fetch(new Request("https://sharehtml.zhenjia.dev" + path, { headers: { "user-agent": "OAI-SearchBot" } }), env, ctx);
  await Promise.all(jobs);
  assert.equal(response.status, 200);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_name, "page_served");
  assert.equal(events[0].route, path.startsWith("/s/") ? "/s/:slug" : path);
  assert.equal(events[0].actor_category, "ai_search");
  assert.equal(events[0].actor_evidence, "ua_self_reported");
  assert.equal(events[0].transport, "http_api");
  assert.equal(events[0].status, 200);
  assert.equal(events[0].outcome, "success");
  assert.equal(events[0].session_id, null);
  assert.ok(!JSON.stringify(events).includes("private-slug"));
});

test("page_served excludes HEAD, errors, unknown routes and Markdown discovery", async () => {
  const events: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("/rpc/record_analytics_event")) {
      events.push(JSON.parse(String(init?.body)).payload);
      return new Response("true", { headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { headers: { "content-type": "application/json" } });
  }));
  const env = { ...makeEnv(), ANALYTICS_ENABLED: "true" };
  const jobs: Promise<unknown>[] = [];
  const ctx = { waitUntil: (job: Promise<unknown>) => jobs.push(job) } as ExecutionContext;
  for (const path of ["/", "/agents", "/s/missing"]) await worker.fetch(new Request("https://sharehtml.zhenjia.dev" + path, { method: "HEAD" }), env, ctx);
  for (const path of ["/s/missing", "/not-a-page"]) {
    const response = await worker.fetch(new Request("https://sharehtml.zhenjia.dev" + path), env, ctx);
    assert.equal(response.status, 404);
  }
  env.ASSETS.fetch = vi.fn(async () => new Response("<html>error</html>", { status: 500, headers: { "content-type": "text/html" } }));
  assert.equal((await worker.fetch(new Request("https://sharehtml.zhenjia.dev/"), env, ctx)).status, 500);
  await worker.fetch(new Request("https://sharehtml.zhenjia.dev/", { headers: { accept: "text/markdown" } }), env, ctx);
  await Promise.all(jobs);
  assert.deepEqual(events.map(event => event.event_name), ["discovery_read"]);
});
