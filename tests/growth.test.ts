import assert from "node:assert/strict";
import { test } from "vitest";

import { INDEXABLE_PATHS } from "../src/shared/marketing.ts";
import {
  INDEXNOW_PATHS,
  buildIndexNowPayload,
  redactIndexNowPayload,
  waitForIndexNowKey,
} from "../scripts/submit-indexnow.mjs";

test("IndexNow allowlist stays identical to the first-party sitemap", () => {
  assert.deepEqual(INDEXNOW_PATHS, INDEXABLE_PATHS);
});

test("IndexNow payload cannot include share, preview, API, or cross-origin URLs", () => {
  const payload = buildIndexNowPayload("https://sharehtml.zhenjia.dev", "test-key-1234");
  assert.equal(payload.host, "sharehtml.zhenjia.dev");
  assert.equal(payload.keyLocation, "https://sharehtml.zhenjia.dev/test-key-1234.txt");
  assert.ok(payload.urlList.every((url) => url.startsWith("https://sharehtml.zhenjia.dev/")));
  assert.ok(payload.urlList.every((url) => !/\/(?:s|v|api)\//.test(new URL(url).pathname)));
});

test("IndexNow dry-run output redacts the key from every field", () => {
  const secret = "indexnow-secret-12345678";
  const printable = redactIndexNowPayload(
    buildIndexNowPayload("https://sharehtml.zhenjia.dev", secret),
    true
  );
  const serialized = JSON.stringify(printable);
  assert.ok(!serialized.includes(secret));
  assert.equal(printable.key, "[configured]");
  assert.equal(printable.keyLocation, "https://sharehtml.zhenjia.dev/[redacted].txt");
});

test("IndexNow verification waits for edge secret propagation without exposing the key", async () => {
  const secret = "indexnow-secret-12345678";
  const statuses = [404, 404, 200];
  const requested: string[] = [];
  const result = await waitForIndexNowKey({
    keyLocation: `https://sharehtml.zhenjia.dev/${secret}.txt`,
    key: secret,
    attempts: 3,
    delayMs: 0,
    fetchImpl: async (url) => {
      requested.push(String(url));
      const status = statuses.shift() ?? 500;
      return new Response(status === 200 ? secret : "Not found", { status });
    },
  });

  assert.deepEqual(result, { ok: true, status: 200 });
  assert.equal(requested.length, 3);
});
