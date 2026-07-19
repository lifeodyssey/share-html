export type MarketingLink = {
  label: string;
  href: string;
};

export type MarketingSection = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
  code?: string;
  links?: MarketingLink[];
};

export type MarketingPage = {
  path: string;
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  lead: string;
  schemaType: "WebPage" | "TechArticle" | "CollectionPage";
  primaryCta: MarketingLink;
  secondaryCta?: MarketingLink;
  sections: MarketingSection[];
};

export type ExampleTemplate = {
  id: string;
  title: string;
  description: string;
  fileUrl: string;
};

export const EXAMPLE_TEMPLATES: ExampleTemplate[] = [
  {
    id: "status-dashboard",
    title: "Status dashboard",
    description: "A responsive, self-contained project status dashboard with no external assets.",
    fileUrl: "/examples/status-dashboard.html",
  },
  {
    id: "product-card",
    title: "Product concept card",
    description: "A polished single-page product concept for sharing a visual direction with a team.",
    fileUrl: "/examples/product-card.html",
  },
  {
    id: "data-brief",
    title: "Data brief",
    description: "A compact report layout for turning generated analysis into a link someone can review.",
    fileUrl: "/examples/data-brief.html",
  },
];

export const MARKETING_PAGES: MarketingPage[] = [
  {
    path: "/html-preview",
    title: "Share an HTML Preview Online — One File, One Sandboxed Link",
    description: "Turn one self-contained HTML file into a sandboxed preview link without configuring a repository, build pipeline, or hosting account.",
    eyebrow: "HTML preview hosting",
    heading: "Turn one HTML file into a link people can open.",
    lead: "Share HTML is for the awkward gap between sending source code and deploying a website: upload a self-contained HTML file, let the Worker scan it, and send the resulting wrapper link.",
    schemaType: "WebPage",
    primaryCta: { label: "Upload an HTML file", href: "/?source=html_preview" },
    secondaryCta: { label: "Start from an example", href: "/examples" },
    sections: [
      {
        title: "What the recipient gets",
        paragraphs: [
          "The share URL opens a wrapper with the document title, moderation state, risk score, expiry, report action, and an embedded preview. The uploaded document itself runs inside a restrictive browser sandbox.",
          "This is deliberately single-file hosting. Inline CSS, SVG, and JavaScript work; folders, build output with multiple assets, and server-side code do not.",
        ],
        bullets: [
          "No signup required for an anonymous upload.",
          "Public-unlisted and access-key-protected private links.",
          "Direct preview URL plus a safer wrapper URL for sharing.",
          "Uploaded share pages are noindex and excluded from the sitemap.",
        ],
      },
      {
        title: "Three steps, no deployment setup",
        paragraphs: [
          "Save the page as a self-contained .html or .htm file, upload it, then copy the wrapper link. Anonymous shares expire after 365 days; signing in lets you keep and delete your shares.",
        ],
        code: "curl -X POST https://sharehtml.zhenjia.dev/api/shares \\\n  -F 'file=@page.html' \\\n  -F 'title=Prototype review'",
      },
      {
        title: "When this is a good fit",
        paragraphs: [
          "Use it for generated prototypes, design explorations, tiny interactive demos, visual reports, receipts, or any one-off page that needs feedback before it deserves a full deployment pipeline.",
          "For production applications, multi-file sites, durable public publishing, or pages that require a trusted same-origin session, use a normal hosting platform instead.",
        ],
      },
    ],
  },
  {
    path: "/private-html-sharing",
    title: "Private HTML Sharing with an Access Key — Share HTML",
    description: "Share a sandboxed HTML preview through an access-key-protected link whose metadata and document stay unavailable until the key is verified.",
    eyebrow: "Access-key protected sharing",
    heading: "Share an HTML preview without making it publicly open.",
    lead: "Private links add a separate 32-byte access key to the normal sandboxed preview flow. The key is returned once, carried in the browser fragment, and exchanged for short-lived HttpOnly grants before metadata or HTML is released.",
    schemaType: "WebPage",
    primaryCta: { label: "Create a private link", href: "/?source=private_html&visibility=private_link" },
    secondaryCta: { label: "Read the API contract", href: "/openapi.json" },
    sections: [
      {
        title: "What private means here",
        paragraphs: [
          "Anyone holding the complete private URL can open the share, so treat it like a password-bearing link. The access key is not stored in plaintext and is different from the claim token used to transfer ownership of an anonymous upload.",
          "Before a successful key exchange, the Worker does not return the share title, lifecycle state, preview document, or R2 object.",
        ],
        bullets: [
          "The key stays in #key= during the initial browser request.",
          "The browser exchanges it through a JSON POST, never a query parameter.",
          "Separate short-lived grants protect metadata and the exact preview path.",
          "Rotating the key invalidates previous keys and grants immediately.",
        ],
      },
      {
        title: "Create a private share from a terminal",
        paragraphs: [
          "Set visibility to private_link. The response contains accessKey and a share.share_url with the same secret in its fragment. Do not paste either value into logs, issue trackers, or public agent transcripts.",
        ],
        code: "curl -X POST https://sharehtml.zhenjia.dev/api/shares \\\n  -F 'file=@page.html' \\\n  -F 'visibility=private_link'",
      },
      {
        title: "Security boundary",
        paragraphs: [
          "Link privacy controls who can retrieve the document; it does not make uploaded code trustworthy. Every preview remains sandboxed, scanned, reportable, and subject to moderation. For identity-based permissions or revocable per-person access, use an authenticated collaboration product instead.",
        ],
      },
    ],
  },
  {
    path: "/examples",
    title: "Single-File HTML Examples You Can Preview and Share",
    description: "Download or reuse self-contained HTML examples for dashboards, product concepts, and data briefs, then publish them as sandboxed links.",
    eyebrow: "Ready-to-share examples",
    heading: "Start with a useful HTML file, not a blank page.",
    lead: "These first-party examples use only inline HTML and CSS, so they show the exact kind of document Share HTML can host. Choose one to preload it into the uploader, inspect its source, or download it for your own project.",
    schemaType: "CollectionPage",
    primaryCta: { label: "Try the status dashboard", href: "/?example=status-dashboard&source=examples" },
    secondaryCta: { label: "Upload your own file", href: "/?source=examples" },
    sections: EXAMPLE_TEMPLATES.map((example) => ({
      title: example.title,
      paragraphs: [example.description],
      links: [
        { label: "Use this example", href: `/?example=${example.id}&source=examples` },
        { label: "Open the HTML source", href: example.fileUrl },
      ],
    })),
  },
  {
    path: "/agents",
    title: "Share HTML for AI Agents — MCP, OpenAPI, A2A, and HTTP",
    description: "Let an AI agent publish a self-contained HTML document through a remote MCP server or a documented HTTP API, with no pre-registration required.",
    eyebrow: "Agent quickstart",
    heading: "Give an agent HTML. Get back a shareable preview link.",
    lead: "Share HTML exposes the same guarded create flow through a remote MCP endpoint and a multipart HTTP API. Anonymous use needs no account or API key; normal upload limits, scanning, sandboxing, and moderation still apply.",
    schemaType: "TechArticle",
    primaryCta: { label: "Copy the MCP endpoint", href: "#mcp-quickstart" },
    secondaryCta: { label: "Open the API description", href: "/openapi.json" },
    sections: [
      {
        title: "Remote MCP quickstart",
        paragraphs: [
          "Connect a Streamable HTTP MCP client to the endpoint below. The server exposes describe_share_html, create_share, and get_public_share. The create tool accepts the full HTML string and an optional title and visibility.",
        ],
        code: "https://sharehtml.zhenjia.dev/mcp",
        links: [
          { label: "MCP server card", href: "/.well-known/mcp/server-card.json" },
          { label: "Registry manifest", href: "/server.json" },
        ],
      },
      {
        title: "Test the MCP connection",
        paragraphs: [
          "Send initialize first, then call tools/list or tools/call using the negotiated protocol version. No bearer token is needed for anonymous creation.",
        ],
        code: "curl https://sharehtml.zhenjia.dev/mcp \\\n  -H 'content-type: application/json' \\\n  -H 'mcp-protocol-version: 2025-11-25' \\\n  --data '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}'",
      },
      {
        title: "Choose the integration surface",
        paragraphs: [
          "Use MCP when the agent host supports remote servers. Use OpenAPI or the raw HTTP endpoint for general automation. Browser agents can inspect the WebMCP manifest, while A2A clients can discover the service card and its implemented describe skill.",
        ],
        links: [
          { label: "OpenAPI 3.1", href: "/openapi.json" },
          { label: "AI-readable guide", href: "/llms.txt" },
          { label: "WebMCP manifest", href: "/.well-known/webmcp.json" },
          { label: "A2A agent card", href: "/.well-known/agent-card.json" },
          { label: "Agent skill", href: "/.well-known/agent-skills/share-html/SKILL.md" },
        ],
      },
      {
        title: "Handle private links as secrets",
        paragraphs: [
          "For private_link, create_share returns accessKey once and places it in share.share_url as a #key= fragment. Ask the user before consuming a private key, keep it out of query parameters and logs, and never repeat the complete private URL in a public response.",
        ],
      },
    ],
  },
];

export const INDEXABLE_PATHS = ["/", ...MARKETING_PAGES.map((page) => page.path)];

export function marketingPageForPath(pathname: string): MarketingPage | undefined {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return MARKETING_PAGES.find((page) => page.path === normalized);
}

export function exampleTemplateById(id: string | null): ExampleTemplate | undefined {
  return EXAMPLE_TEMPLATES.find((example) => example.id === id);
}
