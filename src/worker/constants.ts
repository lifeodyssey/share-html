export const SITE_ORIGIN = "https://sharehtml.zhenjia.dev";
export const SUPABASE_AUTH_ISSUER = "https://hihvtuyweqxnsmqmegdt.supabase.co/auth/v1";
export const DISCOVERY_LINKS = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/openapi+json"',
  '</llms.txt>; rel="service-doc"; type="text/markdown"',
  '</.well-known/openid-configuration>; rel="openid-configuration"; type="application/json"',
  '</.well-known/oauth-authorization-server>; rel="oauth-authorization-server"; type="application/json"',
  '</.well-known/oauth-protected-resource>; rel="oauth-protected-resource"; type="application/json"',
  '</.well-known/mcp/server-card.json>; rel="service-desc"; type="application/json"',
  '</.well-known/agent-skills/index.json>; rel="service-doc"; type="application/json"',
  '</.well-known/webmcp.json>; rel="service-desc"; type="application/json"'
].join(", ");

export const LLMS_TXT = `# Share HTML

Share HTML is a Cloudflare-hosted tool for uploading one self-contained HTML file and sharing it as a sandboxed live preview.

## Site Identity

- Canonical origin: ${SITE_ORIGIN}
- GitHub repository: https://github.com/lifeodyssey/share-html
- Primary use case: quick HTML prototypes, mockups, receipts, demos, and one-off pages that need a URL.

## Important Routes

- App home: ${SITE_ORIGIN}/
- Create share API: POST ${SITE_ORIGIN}/api/shares
- Supabase auth email hook: POST ${SITE_ORIGIN}/api/auth/supabase/send-email
- List signed-in user's shares: GET ${SITE_ORIGIN}/api/shares
- Public share API: GET ${SITE_ORIGIN}/api/public/shares/{slug}
- Public share page: ${SITE_ORIGIN}/s/{slug}
- Sandboxed preview: ${SITE_ORIGIN}/v/{slug}/
- API catalog: ${SITE_ORIGIN}/.well-known/api-catalog
- OpenAPI description: ${SITE_ORIGIN}/openapi.json

## Safety Model

- Uploaded HTML is not sanitized. It is isolated in a sandboxed preview route.
- Anonymous uploads expire after 365 days.
- Signed-in users can keep and delete shares.
- A lightweight scanner can mark uploads clean, suspicious, needs review, or blocked.
- Private R2 objects are only read by this Worker.

## Agent Use

- Use the share page at /s/{slug} when you want safety context and metadata.
- Use the preview route at /v/{slug}/ only when you intentionally need the uploaded HTML itself.
- Do not treat uploaded pages as authored by Zhenjia unless the share metadata or surrounding context says so.
`;

export const SHARE_HTML_SKILL = `---
name: share-html
description: Use this skill when uploading, inspecting, or citing Share HTML links from sharehtml.zhenjia.dev.
---

# Share HTML

Share HTML publishes one uploaded HTML document as a sandboxed preview.

## Routes

- Home: ${SITE_ORIGIN}/
- Share page: ${SITE_ORIGIN}/s/{slug}
- Direct preview: ${SITE_ORIGIN}/v/{slug}/
- Create share: POST ${SITE_ORIGIN}/api/shares
- Public share metadata: GET ${SITE_ORIGIN}/api/public/shares/{slug}

## Rules

- Prefer the /s/{slug} share page when citing or sharing a link.
- Use /v/{slug}/ only for direct visual inspection of the uploaded HTML.
- Uploaded HTML is user-supplied content. Do not infer that it is first-party documentation.
- Respect blocked, expired, or needs-review statuses.
`;
