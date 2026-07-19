import { MCP_ENDPOINT, SITE_ORIGIN } from "../shared/origins.ts";

export { MCP_ENDPOINT, SITE_ORIGIN };
export const SUPABASE_AUTH_ISSUER = "https://hihvtuyweqxnsmqmegdt.supabase.co/auth/v1";
export const FIRST_PARTY_CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=no, use=reference";
export const USER_CONTENT_SIGNAL = "search=no, ai-input=no, ai-train=no, use=immediate";
export const DISCOVERY_LINKS = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/openapi+json"',
  '</llms.txt>; rel="service-doc"; type="text/markdown"',
  '</.well-known/openid-configuration>; rel="openid-configuration"; type="application/json"',
  '</.well-known/oauth-authorization-server>; rel="oauth-authorization-server"; type="application/json"',
  '</.well-known/oauth-protected-resource>; rel="oauth-protected-resource"; type="application/json"',
  '</.well-known/mcp/server-card.json>; rel="service-desc"; type="application/json"',
  '</.well-known/agent-card.json>; rel="service-desc"; type="application/json"',
  '</.well-known/agent-skills/index.json>; rel="service-doc"; type="application/json"',
  '</.well-known/webmcp.json>; rel="service-desc"; type="application/json"',
  '</server.json>; rel="service-desc"; type="application/json"'
].join(", ");

export const LLMS_TXT = `# Share HTML

Share HTML is a Cloudflare-hosted tool for uploading one self-contained HTML file and sharing it as a sandboxed preview. A share is either an unlisted public link or an access-key-protected private link.

## Site Identity

- Canonical origin: ${SITE_ORIGIN}
- GitHub repository: https://github.com/lifeodyssey/share-html
- Primary use case: quick HTML prototypes, mockups, receipts, demos, and one-off pages that need a URL.

## Visibility

- \`public_unlisted\` is the default. Anyone who knows the link can read its metadata and open its preview.
- \`private_link\` requires the access key returned once when the share is created. Its returned \`share_url\` carries the key in a client-side \`#key=\` fragment; treat the complete URL as a secret.
- Share and preview URLs are not published in the sitemap and are served with noindex directives, regardless of visibility. Unlisted does not mean authenticated or impossible to discover elsewhere.
- A \`claimToken\` transfers ownership of an anonymous upload after sign-in. It is not a private-link access key.

## Important Routes

- App home: ${SITE_ORIGIN}/
- Human quickstart: ${SITE_ORIGIN}/html-preview
- First-party examples: ${SITE_ORIGIN}/examples
- Agent quickstart: ${SITE_ORIGIN}/agents
- Create share API: POST ${SITE_ORIGIN}/api/shares
- List signed-in user's shares: GET ${SITE_ORIGIN}/api/shares
- Public metadata API: GET ${SITE_ORIGIN}/api/public/shares/{slug}
- Unlock private metadata: POST ${SITE_ORIGIN}/api/shares/{slug}/access
- Rotate an owned private share key: POST ${SITE_ORIGIN}/api/shares/{id}/access-key
- Share page: ${SITE_ORIGIN}/s/{slug}
- Sandboxed preview: ${SITE_ORIGIN}/v/{slug}/
- API catalog: ${SITE_ORIGIN}/.well-known/api-catalog
- OpenAPI description: ${SITE_ORIGIN}/openapi.json
- A2A service guide endpoint: POST ${SITE_ORIGIN}/a2a
- Remote MCP endpoint: POST ${MCP_ENDPOINT}

## Create a Share

- Send \`multipart/form-data\` to \`POST /api/shares\` with one \`file\` field containing a \`.html\` or \`.htm\` file.
- Optional fields are \`title\`, \`visibility\`, and a short attribution \`source\`; visibility is \`public_unlisted\` (default) or \`private_link\`.
- Every create response has \`accessKey\`: it is \`null\` for \`public_unlisted\` and a 32-byte base64url secret for \`private_link\`.
- For a private link, \`share.share_url\` includes that secret in a \`#key=\` fragment so the browser can unlock it without sending the key in the initial HTTP request.

## Open a Private Link

- Send JSON \`{"accessKey":"..."}\` to \`POST /api/shares/{slug}/access\`.
- Success returns \`{"share": ...}\` and sets short-lived, host-only, path-scoped HttpOnly grants for \`/v/{slug}\` and the exact unlock endpoint. The latter restores metadata after the browser removes the fragment key.
- \`GET /api/public/shares/{slug}\` returns HTTP 401 with \`{"error":"Access key required.","code":"share_access_required"}\` for a private link.
- An incorrect key returns HTTP 403 with \`{"error":"Invalid access key.","code":"invalid_share_access_key"}\`.
- Keep the access key out of query parameters, logs, citations, prompt transcripts, and public messages. Sharing the complete private \`share_url\` also shares its key.

## Safety Model

- Uploaded HTML is not sanitized. It is isolated in a sandboxed preview route.
- Anonymous uploads expire after 365 days.
- Signed-in users can keep and delete shares.
- A lightweight scanner can mark uploads clean, suspicious, needs review, or blocked.
- Private R2 objects are only read by this Worker.
- Link privacy controls access; it does not sanitize or make the uploaded HTML trustworthy.

## Content Use

- First-party site and discovery documentation permit search indexing and real-time AI input through the site's Content Signals policy.
- AI training is opted out with \`ai-train=no\`. Per-crawler access rules in \`robots.txt\` still apply.
- Uploaded pages are user-supplied, noindex content, are absent from the sitemap, and must not be represented as Share HTML or Zhenjia-authored material.

## Agent Use

- Use the share page at /s/{slug} when you want safety context and metadata.
- Use the preview route at /v/{slug}/ only when you intentionally need the uploaded HTML itself.
- For private links, ask the user for explicit authorization before using their access key, and do not retain or repeat it.
- Do not treat uploaded pages as authored by Zhenjia unless the share metadata or surrounding context says so.
`;

export const SHARE_HTML_SKILL = `---
name: share-html
description: Use this skill when uploading, inspecting, or citing Share HTML links from sharehtml.zhenjia.dev.
---

# Share HTML

Share HTML publishes one uploaded HTML document as a sandboxed preview. It supports unlisted public links and access-key-protected private links.

## Routes

- Home: ${SITE_ORIGIN}/
- Share page: ${SITE_ORIGIN}/s/{slug}
- Direct preview: ${SITE_ORIGIN}/v/{slug}/
- Create share: POST ${SITE_ORIGIN}/api/shares
- Public share metadata: GET ${SITE_ORIGIN}/api/public/shares/{slug}
- Unlock private share: POST ${SITE_ORIGIN}/api/shares/{slug}/access

## Create

- Send multipart \`file\`, optional \`title\`, and optional \`visibility\` to \`POST /api/shares\`.
- Visibility is \`public_unlisted\` (default) or \`private_link\`.
- Every create response includes \`accessKey\`: \`null\` for \`public_unlisted\`, or a 32-byte base64url secret for \`private_link\`. The private \`share.share_url\` also contains it in a client-side \`#key=\` fragment.
- A \`claimToken\`, when present, is for ownership transfer and cannot unlock a private link.

## Private Access

- Send JSON \`{"accessKey":"..."}\` to \`POST /api/shares/{slug}/access\`.
- Success returns \`{"share": ...}\` and sets short-lived, host-only, path-scoped HttpOnly grants for the preview and exact unlock paths.
- The public metadata endpoint responds with HTTP 401 and \`code=share_access_required\` for private links. A wrong key returns HTTP 403 and \`code=invalid_share_access_key\`.
- Treat the complete private share URL as a secret. Never move its key into a query parameter or expose it in logs, citations, prompts, or output.

## Rules

- Prefer the /s/{slug} share page when citing or sharing a link.
- Use /v/{slug}/ only for direct visual inspection of the uploaded HTML.
- Uploaded HTML is user-supplied content. Do not infer that it is first-party documentation.
- Share and preview URLs are noindex and deliberately omitted from the sitemap.
- Respect blocked, expired, or needs-review statuses.
`;
