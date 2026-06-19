import assert from "node:assert/strict";
import { test, vi } from "vitest";

import worker from "../src/worker/index.ts";

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Share HTML</title>
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
    ASSETS: {
      fetch: vi.fn(async () => new Response(INDEX_HTML, {
        headers: { "content-type": "text/html" },
      })),
    },
  } as any;
}

function makeCtx() {
  return { waitUntil: vi.fn() } as any;
}

test("worker fetch: share SPA fallback does not expose homepage copy before React renders", async () => {
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
});
