import { LLMS_TXT } from "./constants.ts";
import { getShareBySlug, toPublicShare } from "./db.ts";
import { withDiscoveryHeaders } from "./http.ts";
import { createShareRecord } from "./shares.ts";
import { errorMessage } from "./utils.ts";

type Env = {
  ASSETS: Fetcher;
  AUTH_EMAIL?: SendEmail;
  SHARE_HTML_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_REST_KEY: string;
  WORKER_API_SECRET: string;
  SHARE_ACCESS_PEPPER_V1: string;
  PREVIEW_GRANT_SIGNING_KEY_V1: string;
  SUPABASE_SEND_EMAIL_HOOK_SECRET?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_FROM_NAME?: string;
  APP_ORIGIN?: string;
  PREVIEW_ORIGIN?: string;
  IP_HASH_SALT?: string;
  MAX_ANON_HTML_BYTES?: string;
  MAX_USER_HTML_BYTES?: string;
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const MCP_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_MCP_PROTOCOL_VERSIONS = new Set([
  "2025-03-26",
  "2025-06-18",
  MCP_PROTOCOL_VERSION,
]);

export async function handleMcpRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "GET" || request.method === "HEAD") {
    return withDiscoveryHeaders(new Response(null, {
      status: 405,
      headers: { Allow: "POST" },
    }));
  }

  if (request.method !== "POST") {
    return withDiscoveryHeaders(new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } }));
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return withDiscoveryHeaders(new Response("Forbidden", { status: 403 }));
  }

  const requestedVersion = request.headers.get("mcp-protocol-version");
  if (requestedVersion && !SUPPORTED_MCP_PROTOCOL_VERSIONS.has(requestedVersion)) {
    return mcpJson({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Unsupported MCP protocol version." },
    }, 400);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return mcpJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }

  if (Array.isArray(payload)) {
    return mcpJson({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "JSON-RPC batching is not supported." },
    }, 400);
  }

  if (isJsonRpcResponse(payload)) {
    return withDiscoveryHeaders(new Response(null, { status: 202 }));
  }

  const response = await handleMcpMessage(payload, request, env, ctx);
  if (response === null) {
    return withDiscoveryHeaders(new Response(null, { status: 202 }));
  }
  return mcpJson(response);
}

export async function handleMcpMessage(message: unknown, request: Request, env: Env, ctx: ExecutionContext): Promise<Record<string, unknown> | null> {
  if (!isJsonRpcRequest(message)) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  }

  if (!("id" in message)) return null;

  try {
    switch (message.method) {
      case "initialize":
        return mcpResult(message.id, {
          protocolVersion: negotiatedProtocolVersion(message.params),
          capabilities: { tools: {} },
          serverInfo: { name: "Share HTML", version: "0.1.0" }
        });
      case "tools/list":
        return mcpResult(message.id, { tools: mcpTools() });
      case "tools/call":
        return await handleMcpToolCall(message.id, message.params, request, env, ctx);
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } };
    }
  } catch (error) {
    return { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: errorMessage(error) } };
  }
}

export function isJsonRpcRequest(value: unknown): value is { jsonrpc: "2.0"; id?: unknown; method: string; params?: unknown } {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (value as { method?: unknown }).method === "string";
}

function isJsonRpcResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown };
  return message.jsonrpc === "2.0" && "id" in message &&
    (("result" in message) !== ("error" in message));
}

function negotiatedProtocolVersion(params: unknown): string {
  const requested = params && typeof params === "object"
    ? (params as { protocolVersion?: unknown }).protocolVersion
    : undefined;
  return typeof requested === "string" && SUPPORTED_MCP_PROTOCOL_VERSIONS.has(requested)
    ? requested
    : MCP_PROTOCOL_VERSION;
}

export function mcpResult(id: unknown, result: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

export function mcpTools() {
  return [
    {
      name: "describe_share_html",
      description: "Return the AI-readable Share HTML guide, including routes and safety model.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
      name: "get_public_share",
      description: "Fetch public metadata for a Share HTML slug.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Public Share HTML slug" }
        },
        required: ["slug"],
        additionalProperties: false
      }
    }
    ,{
      name: "create_share",
      description: "Publish one HTML page as either an unlisted or access-key protected sandboxed share.",
      inputSchema: {
        type: "object",
        properties: {
          html: { type: "string", description: "The full HTML document to publish." },
          title: { type: "string", description: "Optional title for the share." },
          visibility: {
            type: "string",
            enum: ["public_unlisted", "private_link"],
            description: "Defaults to public_unlisted. private_link returns a one-time accessKey."
          }
        },
        required: ["html"],
        additionalProperties: false
      }
    }
  ];
}

export async function handleMcpToolCall(
  id: unknown,
  params: unknown,
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Record<string, unknown>> {
  const call = params as { name?: string; arguments?: Record<string, unknown> } | null;

  if (call?.name === "describe_share_html") {
    return mcpResult(id, { content: [{ type: "text", text: LLMS_TXT }] });
  }

  if (call?.name === "get_public_share") {
    const slug = typeof call.arguments?.slug === "string" ? call.arguments.slug : "";
    if (!slug) {
      return mcpResult(id, { isError: true, content: [{ type: "text", text: "Missing required slug." }] });
    }

    const share = await getShareBySlug(env, slug);
    if (!share || share.deleted_at || share.visibility !== "public_unlisted") {
      return mcpResult(id, { isError: true, content: [{ type: "text", text: "Share not found." }] });
    }

    return mcpResult(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(toPublicShare(share, request, env), null, 2)
        }
      ]
    });
  }

  if (call?.name === "create_share") {
    const html = typeof call.arguments?.html === "string" ? call.arguments.html : "";
    if (!html) {
      return mcpResult(id, { isError: true, content: [{ type: "text", text: "Missing required 'html'." }] });
    }
    const title = typeof call.arguments?.title === "string" ? call.arguments.title : "";
    const rawVisibility = call.arguments?.visibility;
    if (
      rawVisibility !== undefined &&
      rawVisibility !== "public_unlisted" &&
      rawVisibility !== "private_link"
    ) {
      return mcpResult(id, {
        isError: true,
        content: [{ type: "text", text: "visibility must be public_unlisted or private_link." }]
      });
    }
    const visibility = rawVisibility === "private_link" ? "private_link" : "public_unlisted";
    const result = await createShareRecord(env, ctx, request, {
      html,
      title,
      user: null,
      visibility,
      source: "mcp",
    });
    return mcpResult(id, {
      isError: result.status >= 400,
      content: [{ type: "text", text: JSON.stringify(result.body, null, 2) }]
    });
  }

  return mcpResult(id, { isError: true, content: [{ type: "text", text: "Unknown tool." }] });
}

export function mcpJson(body: unknown, status = 200): Response {
  return withDiscoveryHeaders(new Response(JSON.stringify(body, null, 2), {
    status,
    headers: JSON_HEADERS,
  }));
}
