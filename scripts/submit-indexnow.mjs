import { pathToFileURL } from "node:url";

export const INDEXNOW_PATHS = [
  "/",
  "/html-preview",
  "/private-html-sharing",
  "/examples",
  "/agents",
];

const BLOCKED_PREFIXES = ["/s/", "/v/", "/api/"];

export function buildIndexNowPayload(origin, key) {
  const site = new URL(origin);
  const urlList = INDEXNOW_PATHS.map((path) => new URL(path, site).toString());
  for (const url of urlList) {
    const candidate = new URL(url);
    if (candidate.host !== site.host || BLOCKED_PREFIXES.some((prefix) => candidate.pathname.startsWith(prefix))) {
      throw new Error(`Refusing to submit non-first-party URL: ${url}`);
    }
  }
  return {
    host: site.host,
    key,
    keyLocation: new URL(`/${key}.txt`, site).toString(),
    urlList,
  };
}

export function redactIndexNowPayload(payload, configured) {
  const location = new URL(payload.keyLocation);
  return {
    ...payload,
    key: configured ? "[configured]" : "[dry-run]",
    keyLocation: `${location.origin}/[redacted].txt`,
  };
}

export async function waitForIndexNowKey({
  keyLocation,
  key,
  attempts = 15,
  delayMs = 2_000,
  fetchImpl = fetch,
}) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const verification = await fetchImpl(keyLocation, {
        redirect: "error",
        cache: "no-store",
      });
      lastStatus = verification.status;
      if (verification.ok && (await verification.text()).trim() === key) {
        return { ok: true, status: verification.status };
      }
    } catch {
      lastStatus = 0;
    }
    if (attempt + 1 < attempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return { ok: false, status: lastStatus };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const originArg = process.argv.find((arg) => arg.startsWith("--origin="));
  const origin = originArg?.slice("--origin=".length) || "https://sharehtml.zhenjia.dev";
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key && !dryRun) {
    throw new Error("INDEXNOW_KEY is required. Generate 8-128 allowed characters and configure the same Worker secret first.");
  }
  const effectiveKey = key || "dry-run-key";
  if (!/^[A-Za-z0-9-]{8,128}$/.test(effectiveKey)) {
    throw new Error("INDEXNOW_KEY must be 8-128 letters, numbers, or dashes.");
  }

  const payload = buildIndexNowPayload(origin, effectiveKey);
  if (dryRun) {
    console.log(JSON.stringify(redactIndexNowPayload(payload, Boolean(key)), null, 2));
    return;
  }

  const verification = await waitForIndexNowKey({
    keyLocation: payload.keyLocation,
    key: effectiveKey,
  });
  if (!verification.ok) {
    const status = verification.status || "network error";
    throw new Error(`IndexNow key verification failed (${status}). Confirm the Worker secret and verification route before retrying.`);
  }

  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`IndexNow rejected the allowlisted URLs with HTTP ${response.status}.`);
  }
  console.log(JSON.stringify({ ok: true, status: response.status, submitted: payload.urlList }, null, 2));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
