import { DISCOVERY_LINKS } from "./constants.ts";

export function acceptsMarkdown(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return (request.headers.get("accept") || "").toLowerCase().includes("text/markdown");
}

export function withDiscoveryHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const currentLink = headers.get("Link");
  headers.set("Link", currentLink ? `${currentLink}, ${DISCOVERY_LINKS}` : DISCOVERY_LINKS);
  headers.set("X-Content-Type-Options", headers.get("X-Content-Type-Options") ?? "nosniff");
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
