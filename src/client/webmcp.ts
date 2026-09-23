import { analyticsRoute, uploadAnalyticsContext } from "./analytics";

type ToolResult = { isError?: boolean; [key: string]: unknown };
type Tool = { name: string; description: string; inputSchema: unknown; execute: (args: Record<string, unknown>) => Promise<ToolResult> };
type ModelContext = { provideContext: (context: { tools: Tool[] }) => unknown };
type Phase = "available" | "registered" | "started" | "result";
let available = false;
let registration: "pending" | "success" | "failure" = "pending";
let observed = false;
const reported = new Set<string>();

function emit(phase: Phase, outcome: "success" | "failure" | null, tool?: string): void {
  try {
    const current = uploadAnalyticsContext();
    const route = analyticsRoute(window.location.pathname);
    if (!current || !route) return;
    if (phase === "available" || phase === "registered") {
      const key = `${current.session_id}:${phase}:${outcome}`;
      if (reported.has(key)) return;
      reported.add(key);
    }
    void fetch("/api/analytics/events", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", keepalive: true,
      body: JSON.stringify({ event: ({ available: "webmcp_available", registered: "webmcp_registered", started: "webmcp_call", result: "webmcp_result" } as const)[phase], event_id: crypto.randomUUID(), ...current, route, transport: "webmcp", phase, outcome, tool }),
    }).catch(() => {});
  } catch { /* Optional telemetry never changes tool execution. */ }
}

export function reportWebMcpState(): void {
  if (!observed) return;
  emit("available", available ? "success" : "failure");
  if (registration !== "pending") emit("registered", registration);
}

export function instrumentWebMcpTool(tool: Tool): Tool {
  return { ...tool, execute: async (args) => {
    reportWebMcpState();
    emit("started", null, tool.name);
    try {
      const result = await tool.execute(args);
      emit("result", result.isError ? "failure" : "success", tool.name);
      return result;
    } catch (error) {
      emit("result", "failure", tool.name);
      throw error;
    }
  } };
}

export async function provideShareHtmlContext(): Promise<void> {
  const modelContext = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  observed = true;
  available = Boolean(modelContext && typeof modelContext.provideContext === "function");
  reportWebMcpState();
  if (!available || !modelContext) return;
  try {
    await modelContext.provideContext({ tools: webMcpTools().map(instrumentWebMcpTool) });
    registration = "success";
    reportWebMcpState();
  } catch (error) {
    registration = "failure";
    reportWebMcpState();
    throw error;
  }
}

export function webMcpTools(): Tool[] {
  return [
    {
      name: "describe_share_html",
      description: "Return the Share HTML routes, API discovery URLs, and safety model.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({
        content: [
          {
            type: "text",
            text: [
              "# Share HTML",
              "",
              "Canonical origin: https://sharehtml.zhenjia.dev",
              "OpenAPI: https://sharehtml.zhenjia.dev/openapi.json",
              "AI guide: https://sharehtml.zhenjia.dev/llms.txt",
              "MCP endpoint: https://sharehtml.zhenjia.dev/mcp",
              "",
              "Visibility: public_unlisted or private_link.",
              "Create private links with multipart visibility=private_link; the response includes accessKey and share.share_url includes it in a client-side #key= fragment.",
              "Unlock private metadata with POST /api/shares/{slug}/access and JSON {\"accessKey\":\"...\"}.",
              "A successful unlock returns metadata and sets separate short-lived HttpOnly grants for metadata recovery and /v/{slug}/.",
              "GET /api/public/shares/{slug} returns 401 code=share_access_required for private links.",
              "Treat an access key and the complete private share URL as secrets; never move the key to a query parameter or expose it in logs or citations."
            ].join("\n")
          }
        ]
      })
    },
    {
      name: "get_public_share",
      description: "Fetch metadata for a public_unlisted Share HTML slug. Private links return 401 share_access_required.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Share HTML slug" }
        },
        required: ["slug"],
        additionalProperties: false
      },
      execute: async (args: Record<string, unknown>) => {
        const slug = args && args.slug;
        if (typeof slug !== "string" || !slug) {
          return { content: [{ type: "text", text: "Missing required slug." }], isError: true };
        }

        const response = await fetch(`/api/public/shares/${encodeURIComponent(slug)}`);
        return {
          content: [
            {
              type: "text",
              text: await response.text()
            }
          ],
          isError: !response.ok
        };
      }
    },
    {
      name: "access_private_share",
      description: "Unlock private_link metadata with an access key. Success sets short-lived metadata-recovery and preview grants.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Private Share HTML slug" },
          accessKey: { type: "string", description: "Secret access key returned once when the private link was created." }
        },
        required: ["slug", "accessKey"],
        additionalProperties: false
      },
      execute: async (args: Record<string, unknown>) => {
        const slug = args && args.slug;
        const accessKey = args && args.accessKey;
        if (typeof slug !== "string" || !slug || typeof accessKey !== "string" || !accessKey) {
          return { content: [{ type: "text", text: "Missing required slug or accessKey." }], isError: true };
        }

        const response = await fetch(`/api/shares/${encodeURIComponent(slug)}/access`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessKey })
        });
        return {
          content: [{ type: "text", text: await response.text() }],
          isError: !response.ok
        };
      }
    },
    {
      name: "create_share",
      description: "Publish one HTML page as public_unlisted (default) or private_link. Private creation returns an accessKey once.",
      inputSchema: {
        type: "object",
        properties: {
          html: { type: "string", description: "The full HTML document to publish." },
          title: { type: "string", description: "Optional title." },
          visibility: {
            type: "string",
            enum: ["public_unlisted", "private_link"],
            default: "public_unlisted",
            description: "Access mode for the new share."
          }
        },
        required: ["html"],
        additionalProperties: false
      },
      execute: async (args: Record<string, unknown>) => {
        const html = args && args.html;
        if (typeof html !== "string" || !html) {
          return { content: [{ type: "text", text: "Missing required html." }], isError: true };
        }
        const body = new FormData();
        body.set("file", new Blob([html], { type: "text/html" }), "index.html");
        if (args.title) body.set("title", String(args.title));
        if (args.visibility) body.set("visibility", String(args.visibility));
        body.set("source", "webmcp");
        const analytics = uploadAnalyticsContext();
        if (analytics) body.set("analytics", JSON.stringify(analytics));
        const response = await fetch("/api/shares", { method: "POST", body });
        return {
          content: [{ type: "text", text: await response.text() }],
          isError: !response.ok
        };
      }
    }
  ];
}
