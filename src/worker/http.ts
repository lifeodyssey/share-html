import { DISCOVERY_LINKS, FIRST_PARTY_CONTENT_SIGNAL } from "./constants.ts";

export function acceptsMarkdown(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return (request.headers.get("accept") || "").toLowerCase().includes("text/markdown");
}

export function withDiscoveryHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const currentLink = headers.get("Link");
  headers.set("Link", currentLink ? `${currentLink}, ${DISCOVERY_LINKS}` : DISCOVERY_LINKS);
  headers.set("X-Content-Type-Options", headers.get("X-Content-Type-Options") ?? "nosniff");
  headers.set("Content-Signal", headers.get("Content-Signal") ?? FIRST_PARTY_CONTENT_SIGNAL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function textResponse(body: string, contentType: string, method: string): Response {
  return new Response(method === "HEAD" ? null : body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=3600"
    }
  });
}

export function jsonResponse(body: unknown, contentType: string, method: string): Response {
  return new Response(method === "HEAD" ? null : JSON.stringify(body, null, 2), {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=3600"
    }
  });
}

export function etaggedJsonResponse(
  body: unknown,
  contentType: string,
  request: Request,
  etag: string
): Response {
  const headers = {
    "content-type": contentType,
    "cache-control": "public, max-age=3600",
    etag,
  };
  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body, null, 2), { headers });
}

export function ifNoneMatchMatches(header: string | null, currentEtag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;

  const candidates: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let index = 0; index < header.length; index += 1) {
    const character = header[index];
    if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === "," && !inQuotes) {
      candidates.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (inQuotes) return false;
  candidates.push(header.slice(start).trim());

  const weakValue = (value: string) => value.replace(/^W\//i, "");
  const expected = weakValue(currentEtag.trim());
  return candidates.some((candidate) => candidate !== "" && weakValue(candidate) === expected);
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json<T>();
  } catch {
    return {} as T;
  }
}

export function json(body: unknown, status = 200): Response {
  return withDiscoveryHeaders(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  }));
}

export function methodNotAllowed(allow: string): Response {
  return withDiscoveryHeaders(new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: allow }
  }));
}

export function corsHeaders(request: Request): Headers {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  headers.set("access-control-allow-origin", request.headers.get("origin") ?? "*");
  headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type");
  return headers;
}
