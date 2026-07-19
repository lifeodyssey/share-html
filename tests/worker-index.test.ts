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
