import { LLMS_TXT } from "./constants.ts";
import { withDiscoveryHeaders } from "./http.ts";

const A2A_VERSION = "1.0";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: unknown;
  method: string;
  params?: unknown;
};

export async function handleA2aRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return withDiscoveryHeaders(new Response(null, {
      status: 405,
      headers: { Allow: "POST" },
    }));
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return withDiscoveryHeaders(new Response("Forbidden", { status: 403 }));
  }

  const requestedVersion = request.headers.get("a2a-version");
  if (requestedVersion && requestedVersion !== A2A_VERSION) {
    return withDiscoveryHeaders(new Response(JSON.stringify({
      type: "https://a2a-protocol.org/errors/version-not-supported",
      title: "Protocol Version Not Supported",
      status: 400,
      supportedVersions: [A2A_VERSION],
    }), {
      status: 400,
      headers: { ...JSON_HEADERS, "content-type": "application/problem+json; charset=utf-8" },
    }));
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return a2aJson(a2aError(null, -32700, "Invalid JSON payload"), 400);
  }

  if (!isJsonRpcRequest(payload)) {
    return a2aJson(a2aError(null, -32600, "Request payload validation error"), 400);
  }
  if (!("id" in payload)) return withDiscoveryHeaders(new Response(null, { status: 202 }));

  if (payload.method === "SendMessage") {
    if (!hasTextMessage(payload.params)) {
      return a2aJson(a2aError(payload.id, -32602, "Invalid parameters"));
    }
    const inputMessage = (payload.params as { message: { contextId?: unknown } }).message;
    return a2aJson({
      jsonrpc: "2.0",
      id: payload.id,
      result: {
        message: {
          messageId: crypto.randomUUID(),
          ...(typeof inputMessage.contextId === "string" ? { contextId: inputMessage.contextId } : {}),
          role: "ROLE_AGENT",
          parts: [{ text: LLMS_TXT }],
        },
      },
    });
  }

  if (payload.method === "ListTasks") {
    const pageSize = listPageSize(payload.params);
    if (pageSize === null) return a2aJson(a2aError(payload.id, -32602, "Invalid parameters"));
    return a2aJson({
      jsonrpc: "2.0",
      id: payload.id,
      result: { tasks: [], nextPageToken: "", pageSize, totalSize: 0 },
    });
  }

  if (payload.method === "GetTask" || payload.method === "CancelTask") {
    return a2aJson(a2aError(payload.id, -32001, "Task not found"));
  }

  if (
    payload.method === "SendStreamingMessage" ||
    payload.method === "SubscribeToTask" ||
    payload.method.includes("PushNotificationConfig")
  ) {
    return a2aJson(a2aError(payload.id, -32004, "Unsupported operation"));
  }

  if (payload.method === "GetExtendedAgentCard") {
    return a2aJson(a2aError(payload.id, -32007, "Extended agent card is not configured"));
  }

  return a2aJson(a2aError(payload.id, -32601, "Method not found"));
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (value as { method?: unknown }).method === "string"
  );
}

function hasTextMessage(params: unknown): params is {
  message: { role: "ROLE_USER"; contextId?: string; parts: Array<{ text: string }> };
} {
  if (!params || typeof params !== "object") return false;
  const message = (params as { message?: unknown }).message;
  if (!message || typeof message !== "object") return false;
  const candidate = message as { role?: unknown; messageId?: unknown; parts?: unknown };
  return candidate.role === "ROLE_USER" &&
    typeof candidate.messageId === "string" &&
    Array.isArray(candidate.parts) &&
    candidate.parts.some((part) => Boolean(
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
    ));
}

function listPageSize(params: unknown): number | null {
  if (!params || typeof params !== "object" || !("pageSize" in params)) return 50;
  const pageSize = (params as { pageSize?: unknown }).pageSize;
  return Number.isInteger(pageSize) && Number(pageSize) >= 1 && Number(pageSize) <= 100
    ? Number(pageSize)
    : null;
}

function a2aError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function a2aJson(body: unknown, status = 200): Response {
  return withDiscoveryHeaders(new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  }));
}
