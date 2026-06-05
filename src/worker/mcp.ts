import { LLMS_TXT } from "./constants.ts";
import { getShareBySlug, toPublicShare } from "./db.ts";
import { withDiscoveryHeaders, jsonResponse } from "./http.ts";
import { createShareRecord } from "./shares.ts";
import { errorMessage } from "./utils.ts";
import { mcpServerCard } from "./discovery.ts";

type Env = {
  ASSETS: Fetcher;
  AUTH_EMAIL?: SendEmail;
  SHARE_HTML_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_REST_KEY: string;
  WORKER_API_SECRET: string;
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
  "content-type": "application/json; charset=utf-8"
};

export async function handleMcpRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "GET" || request.method === "HEAD") {
    return withDiscoveryHeaders(jsonResponse(mcpServerCard(), "application/json; charset=utf-8", request.method));
  }

  if (request.method !== "POST") {
    return withDiscoveryHeaders(new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } }));
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return mcpJson({ id: null, error: { code: -32700, message: "Parse error" } });
  }

  if (Array.isArray(payload)) {
    const responses = (await Promise.all(payload.map((message) => handleMcpMessage(message, request, env, ctx)))).filter(Boolean);
    return mcpJson(responses);
  }

  return mcpJson(await handleMcpMessage(payload, request, env, ctx));
}

export async function handleMcpMessage(message: unknown, request: Request, env: Env, ctx: ExecutionContext): Promise<Record<string, unknown> | null> {
  if (!isJsonRpcRequest(message)) {
    return { id: null, error: { code: -32600, message: "Invalid Request" } };
  }

  if (!("id" in message)) return null;

  try {
    switch (message.method) {
      case "initialize":
        return mcpResult(message.id, {
          protocolVersion: "2024-11-05",
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

export function isJsonRpcRequest(value: unknown): value is { id?: unknown; method: string; params?: unknown } {
  return typeof value === "object" && value !== null && typeof (value as { method?: unknown }).method === "string";
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
      description: "Publish/host/share a single HTML page. Uploads an HTML document and returns a public sandboxed shareable URL. Use when the user wants to share, host, or get a link for an HTML file or page.",
      inputSchema: {
        type: "object",
        properties: {
          html: { type: "string", description: "The full HTML document to publish." },
          title: { type: "string", description: "Optional title for the share." }
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
    if (!share || share.deleted_at) {
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
    const result = await createShareRecord(env, ctx, request, { html, title, user: null });
    return mcpResult(id, {
      isError: result.status >= 400,
      content: [{ type: "text", text: JSON.stringify(result.body, null, 2) }]
    });
  }

  return mcpResult(id, { isError: true, content: [{ type: "text", text: "Unknown tool." }] });
}

export function mcpJson(body: unknown): Response {
  return withDiscoveryHeaders(new Response(JSON.stringify(body, null, 2), { headers: JSON_HEADERS }));
}

