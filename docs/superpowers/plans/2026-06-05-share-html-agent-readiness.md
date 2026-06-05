# Share HTML Agent-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已达 isitagentready Level 5 的基础上,补齐"让 agent 真正用上 Share HTML"的高价值项 + 刷满评分维度的 fail。

**Architecture:** 改动集中在三个文件:`index.html`(首页静态内容 + inline WebMCP + JSON-LD + og 标签)、`src/worker/index.ts`(well-known 404 兜底、auth.md、A2A card、`/mcp` 的 `create_share`、抽出可复用的 `createShareRecord`)、`src/client/main.tsx`(上传 UI 的 aria 语义)。验证用 `npm run build` + 本地/线上 `curl` + 重跑 `isitagentready /api/scan`。

**Tech Stack:** Cloudflare Workers (TypeScript)、React (Vite)、现有 PostgREST/R2 数据层。

---

## File Structure

| 文件 | 改动 |
|------|------|
| `index.html` | `#root` 内嵌静态内容(A1)、inline WebMCP 加 `create_share`(A2c)、`<head>` 加 JSON-LD(B3)+ og:image(B4) |
| `src/worker/index.ts` | `discoveryRoute` 加 auth.md(B1)/agent-card(B2)路由 + well-known 404 兜底(C);抽出 `createShareRecord`(A2a);`mcpTools()` + `handleMcpToolCall` 加 `create_share`(A2b) |
| `src/client/main.tsx` | 上传 `<form>` / file `<input>` 加 `aria-label`(A3) |
| `public/og.png` | 新增 OG 预览图(B4) |
| DNS(Cloudflare 后台) | DNS-AID TXT 记录(B5,非代码) |

**实施顺序**(价值降序,且让后续 task 不被 SPA fallback 干扰):Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10。

---

## Task 1: A1 — 首页给 agent 可读的静态内容

**Files:** Modify: `index.html`

- [ ] **Step 1: 把 `#root` 空壳替换为含静态内容**

把 `index.html` 中的 `<div id="root"></div>` 改为:

```html
    <div id="root">
      <main>
        <h1>Share HTML — upload one HTML file, get a sandboxed shareable link</h1>
        <p>Upload a single self-contained HTML file and get a public, sandboxed preview URL. No signup required; anonymous uploads are kept for 365 days.</p>
        <h2>Use it programmatically</h2>
        <pre>curl -X POST https://sharehtml.zhenjia.dev/api/shares -F "file=@page.html" -F "title=My page"
# returns JSON: { "share": { "share_url", "preview_url", "slug", "id" }, "claimToken" }</pre>
        <p>Full API: <a href="/openapi.json">/openapi.json</a> · AI guide: <a href="/llms.txt">/llms.txt</a> · MCP: <a href="/mcp">/mcp</a></p>
      </main>
    </div>
```

> React 的 `createRoot(...).render(<App/>)`(`main.tsx:571`)挂载时会清空 `#root` 子节点,真人访问无影响;不执行 JS 的 agent 读到上面的内容。

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: build 成功,无类型错误。

- [ ] **Step 3: 验证静态内容进入产物**

Run: `grep -c "Use it programmatically" dist/index.html`
Expected: `1`(Vite 原样保留 `#root` 内的静态 HTML)。

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(agent): add agent-readable static content to homepage shell"
```

---

## Task 2: C — well-known 未匹配路径返回 404(根因修复)

**Files:** Modify: `src/worker/index.ts`(`discoveryRoute`,当前 `return null;` 在第 265 行)

> 目的:未被显式处理的 `/.well-known/*` 不再落到 SPA fallback 返回 200 HTML。必须在 Task 3/4 加完新路由后仍保留此兜底(它在 `discoveryRoute` 末尾,新路由加在它前面)。

- [ ] **Step 1: 在 `discoveryRoute` 的 `return null;` 之前插入 404 兜底**

把 `src/worker/index.ts` 中:

```ts
  if (url.pathname === "/.well-known/security.txt") {
    return textResponse(securityTxt(), "text/plain; charset=utf-8", request.method);
  }

  return null;
}
```

改为:

```ts
  if (url.pathname === "/.well-known/security.txt") {
    return textResponse(securityTxt(), "text/plain; charset=utf-8", request.method);
  }

  if (url.pathname.startsWith("/.well-known/")) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  return null;
}
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 3: 本地起 worker 验证(可选,需要 wrangler dev)**

Run: `npx wrangler dev --local` 后另开终端 `curl -s -o /dev/null -w "%{http_code}" http://localhost:8787/.well-known/does-not-exist`
Expected: `404`(而非 200)。

- [ ] **Step 4: Commit**

```bash
git add src/worker/index.ts
git commit -m "fix(agent): return 404 for unknown well-known paths instead of SPA shell"
```

---

## Task 3: B1 — `auth.md`

**Files:** Modify: `src/worker/index.ts`(`discoveryRoute` 内,加在 Task 2 的 404 兜底**之前**;新增 `authMarkdown()` 函数,可放在 `securityTxt` 附近)

- [ ] **Step 1: 新增 `authMarkdown()` 内容函数**

在 `src/worker/index.ts` 内(建议紧邻其它内容生成函数,如 `securityTxt` 之后)新增:

```ts
function authMarkdown(): string {
  return [
    "# Authentication — Share HTML",
    "",
    "## Anonymous (no auth)",
    "- `POST /api/shares` accepts uploads with no authentication.",
    "- Anonymous uploads are rate-limited and kept for 365 days.",
    "",
    "## Signed-in (Supabase)",
    "- Sign-in uses Supabase email OTP (magic link).",
    "- Authenticated API calls send `Authorization: Bearer <supabase_access_token>`.",
    "",
    "## Protected endpoints (require Bearer token)",
    "- `GET /api/shares` — list your shares",
    "- `DELETE /api/shares/{id}` — delete a share",
    "- `POST /api/shares/{id}/claim` — claim an anonymous upload",
    "",
    `Discovery: ${SITE_ORIGIN}/.well-known/oauth-protected-resource`
  ].join("\n");
}
```

- [ ] **Step 2: 在 `discoveryRoute` 注册路由(放在 404 兜底之前)**

在 `discoveryRoute` 内、`if (url.pathname.startsWith("/.well-known/"))` 兜底**之前**插入:

```ts
  if (url.pathname === "/.well-known/auth.md" || url.pathname === "/auth.md") {
    return textResponse(authMarkdown(), "text/markdown; charset=utf-8", request.method);
  }
```

> 注意:`/auth.md`(非 well-known)不在 discoveryRoute 的 404 兜底范围内,但它在 `discoveryRoute` 里被显式处理后 `return`,不会落到 SPA。两个路径都挂以匹配检测器。

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add src/worker/index.ts
git commit -m "feat(agent): serve auth.md describing the auth model"
```

---

## Task 4: B2 — A2A Agent Card

**Files:** Modify: `src/worker/index.ts`(新增 `a2aAgentCard()`;在 `discoveryRoute` 注册)

- [ ] **Step 1: 新增 `a2aAgentCard()` 函数**

在 `src/worker/index.ts` 内新增(建议放在 `mcpServerCard` 附近):

```ts
function a2aAgentCard() {
  return {
    name: "Share HTML",
    description: "Upload one HTML file and get a public sandboxed shareable preview link.",
    url: SITE_ORIGIN,
    version: "1.0.0",
    capabilities: { streaming: false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    skills: [
      {
        id: "create_share",
        name: "Create share",
        description: "Upload an HTML document and return a public shareable URL.",
        tags: ["html", "hosting", "share"]
      },
      {
        id: "get_public_share",
        name: "Get public share",
        description: "Fetch public metadata for a Share HTML slug.",
        tags: ["metadata"]
      }
    ]
  };
}
```

- [ ] **Step 2: 注册路由(放在 well-known 404 兜底之前)**

在 `discoveryRoute` 内插入:

```ts
  if (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/.well-known/agent.json") {
    return jsonResponse(a2aAgentCard(), "application/json; charset=utf-8", request.method);
  }
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add src/worker/index.ts
git commit -m "feat(agent): serve A2A agent card JSON"
```

---

## Task 5: A2 — `create_share` 工具(重构 + /mcp + inline WebMCP)

### Task 5a: 抽出可复用的 `createShareRecord`

**Files:** Modify: `src/worker/index.ts`(`createShare`,第 727–830 行)

> 现状:`createShare` 把 HTTP 解析(formData/file)与业务逻辑(限流/扫描/写存储)耦合。抽出核心函数,让 `/mcp` 复用,**确保 MCP 上传同样经过限流 + 风险扫描(安全红线)**。

- [ ] **Step 1: 新增 `createShareRecord` 核心函数**

在 `src/worker/index.ts` 中 `createShare` 函数**之后**新增:

```ts
async function createShareRecord(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  opts: { html: string; title: string; user: AuthUser | null }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { html, title, user } = opts;

  const ipHash = await hashText(getClientIp(request), env.IP_HASH_SALT ?? env.WORKER_API_SECRET);
  const uaHash = await hashText(request.headers.get("user-agent") ?? "unknown", env.IP_HASH_SALT ?? env.WORKER_API_SECRET);

  const rateLimit = await checkUploadRate(env, user, ipHash);
  if (!rateLimit.allowed) {
    return { status: 429, body: { error: rateLimit.reason } };
  }

  const byteLength = new TextEncoder().encode(html).length;
  const maxBytes = user ? numberEnv(env.MAX_USER_HTML_BYTES, 5 * 1024 * 1024) : numberEnv(env.MAX_ANON_HTML_BYTES, 1024 * 1024);
  if (byteLength <= 0 || byteLength > maxBytes) {
    return { status: 413, body: { error: `HTML must be between 1 byte and ${formatBytes(maxBytes)}.` } };
  }

  if (!looksLikeHtml(html)) {
    return { status: 422, body: { error: "The content does not look like an HTML document." } };
  }

  const shareId = crypto.randomUUID();
  const slug = await createUniqueSlug(env);
  const claimToken = user ? null : createSecretToken();
  const claimTokenHash = claimToken ? await hashText(claimToken, env.WORKER_API_SECRET) : null;
  const contentHash = await sha256Hex(html);
  const scan = scanHtml(html);
  const now = new Date();
  const expiresAt = user ? null : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const cleanedTitle = cleanTitle(title, html);
  const r2Prefix = `shares/${shareId}/`;
  const r2Key = `${r2Prefix}index.html`;

  await restInsert<ShareRecord>(env, "shares", {
    id: shareId,
    slug,
    owner_user_id: user?.id ?? null,
    title: cleanedTitle,
    entry_path: "index.html",
    r2_prefix: r2Prefix,
    size_bytes: byteLength,
    content_hash: contentHash,
    lifecycle_status: "uploading",
    moderation_status: "pending",
    risk_score: scan.score,
    risk_reasons: scan.reasons,
    claim_token_hash: claimTokenHash,
    creator_ip_hash: ipHash,
    creator_user_agent_hash: uaHash,
    expires_at: expiresAt
  });

  try {
    await env.SHARE_HTML_BUCKET.put(r2Key, html, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { share_id: shareId, content_hash: contentHash }
    });

    await restInsert(env, "share_assets", {
      share_id: shareId,
      path: "index.html",
      r2_key: r2Key,
      content_type: "text/html; charset=utf-8",
      size_bytes: byteLength,
      content_hash: contentHash
    });

    const [share] = await restUpdate<ShareRecord>(env, "shares", `id=eq.${shareId}`, {
      lifecycle_status: scan.lifecycle,
      moderation_status: scan.status
    });

    ctx.waitUntil(logShareEvent(env, shareId, user?.id ?? null, "created", ipHash, uaHash, { risk_score: scan.score }).catch(logBackgroundError));

    return {
      status: scan.lifecycle === "blocked" ? 202 : 201,
      body: {
        share: toPublicShare(share, request, env),
        claimToken,
        message: scan.lifecycle === "blocked" ? "Uploaded, but blocked by automatic risk checks." : "Uploaded."
      }
    };
  } catch (error) {
    await restUpdate(env, "shares", `id=eq.${shareId}`, {
      lifecycle_status: "failed",
      moderation_status: "pending"
    });
    console.error(JSON.stringify({ event: "upload_failed", share_id: shareId, message: errorMessage(error) }));
    return { status: 500, body: { error: "Upload failed after metadata was created." } };
  }
}
```

- [ ] **Step 2: 改 `createShare` 复用核心函数**

把 `createShare` 第 736–829 行(从 `const ipHash = ...` 到函数 `}` 之前的 return/catch 块)替换为:仅保留 HTTP 专属的解析与校验,然后委托给 `createShareRecord`。具体:把 `createShare` 中**从 `const ipHash` 起到末尾**整段替换为:

```ts
  const form = await request.formData();
  const file = form.get("file");
  if (!isUploadFile(file)) {
    return json({ error: "Upload a single HTML file." }, 422);
  }

  const filename = file.name.toLowerCase();
  if (filename && !filename.endsWith(".html") && !filename.endsWith(".htm")) {
    return json({ error: "Only .html files are supported in this version." }, 422);
  }

  const html = await file.text();
  const title = typeof form.get("title") === "string" ? (form.get("title") as string) : "";

  const result = await createShareRecord(env, ctx, request, { html, title, user });
  return json(result.body, result.status);
}
```

> 说明:大小校验、`looksLikeHtml`、限流已移入 `createShareRecord`(对 file 与 MCP 两条路统一)。`createShare` 仍保留文件扩展名校验(file 专属)与 `getOptionalUser`/`banned_at` 检查(在第 731–734 行,保持不动)。

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 成功,无类型错误(`AuthUser` 类型已在文件中存在,`numberEnv`/`looksLikeHtml`/`cleanTitle`/`scanHtml`/`toPublicShare` 均为现有函数)。

- [ ] **Step 4: Commit**

```bash
git add src/worker/index.ts
git commit -m "refactor(upload): extract createShareRecord shared by HTTP and MCP"
```

### Task 5b: `/mcp` 加 `create_share` 工具

**Files:** Modify: `src/worker/index.ts`(`mcpTools()` 第 531 行、`handleMcpToolCall` 第 553 行)

- [ ] **Step 1: 在 `mcpTools()` 工具数组追加 `create_share`**

在 `mcpTools()` 返回数组的 `get_public_share` 之后追加:

```ts
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
```

- [ ] **Step 2: 在 `handleMcpToolCall` 加 `create_share` 分支**

在 `handleMcpToolCall` 内、`return mcpResult(id, { isError: true, content: [{ type: "text", text: "Unknown tool." }] });` **之前**插入。注意需要 `ctx`,因此修改 `handleMcpToolCall` 签名与调用方传入 `ctx`(见 Step 3):

```ts
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
```

- [ ] **Step 3: 把 `ctx` 传到 MCP 调用链**

`createShareRecord` 需要 `ExecutionContext`。当前 `handleMcpRequest`/`handleMcpMessage`/`handleMcpToolCall` 不带 `ctx`。改法:

1. `index.ts:138` `return await handleMcpRequest(request, env);` → `return await handleMcpRequest(request, env, ctx);`
2. `handleMcpRequest(request, env)` 签名 → `handleMcpRequest(request: Request, env: Env, ctx: ExecutionContext)`;其内部对 `handleMcpMessage(message, request, env)` 调用改为传 `ctx`。
3. `handleMcpMessage(message, request, env)` 签名加 `ctx: ExecutionContext`;其 `tools/call` 分支 `handleMcpToolCall(message.id, message.params, request, env)` → 加 `ctx`。
4. `handleMcpToolCall(id, params, request, env)` 签名加 `ctx: ExecutionContext`。

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 5: Commit**

```bash
git add src/worker/index.ts
git commit -m "feat(mcp): add create_share tool (rate-limited + scanned)"
```

### Task 5c: index.html inline WebMCP 加 `create_share`

**Files:** Modify: `index.html`(inline `navigator.modelContext.provideContext` 的 `tools` 数组)

- [ ] **Step 1: 在 inline tools 数组追加 `create_share`**

在 `index.html` 的 `tools: [ ... ]` 里、`get_public_share` 工具对象之后追加:

```js
              ,{
                name: "create_share",
                description: "Publish/host/share a single HTML page. Returns a public sandboxed shareable URL.",
                inputSchema: {
                  type: "object",
                  properties: {
                    html: { type: "string", description: "The full HTML document to publish." },
                    title: { type: "string", description: "Optional title." }
                  },
                  required: ["html"],
                  additionalProperties: false
                },
                execute: async (args) => {
                  const html = args && args.html;
                  if (typeof html !== "string" || !html) {
                    return { content: [{ type: "text", text: "Missing required html." }], isError: true };
                  }
                  const body = new FormData();
                  body.set("file", new Blob([html], { type: "text/html" }), "index.html");
                  if (args.title) body.set("title", String(args.title));
                  const response = await fetch("/api/shares", { method: "POST", body });
                  return {
                    content: [{ type: "text", text: await response.text() }],
                    isError: !response.ok
                  };
                }
              }
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 成功(`index.html` 为静态,Vite 原样打包)。

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(webmcp): implement inline create_share tool"
```

---

## Task 6: B3 — 首页 JSON-LD 结构化数据

**Files:** Modify: `index.html`(`<head>`)

- [ ] **Step 1: 在 `<head>` 内 `<title>` 之前加 JSON-LD**

```html
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "name": "Share HTML",
      "url": "https://sharehtml.zhenjia.dev",
      "applicationCategory": "DeveloperApplication",
      "operatingSystem": "Web",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "description": "Upload one HTML file and share it as a sandboxed live preview.",
      "potentialAction": { "@type": "CreateAction", "target": "https://sharehtml.zhenjia.dev/api/shares" }
    }
    </script>
```

- [ ] **Step 2: 验证 JSON-LD 合法**

Run: `node -e "const s=require('fs').readFileSync('index.html','utf8'); const m=s.match(/application\/ld\+json\">([\s\S]*?)<\/script>/); JSON.parse(m[1]); console.log('valid JSON-LD')"`
Expected: 打印 `valid JSON-LD`。

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(seo): add WebApplication JSON-LD to homepage"
```

---

## Task 7: B4 — og:image

**Files:** Create: `public/og.png`(1200×630);Modify: `index.html`(`<head>`)

- [ ] **Step 1: 放置 OG 图**

把一张 1200×630 PNG 放到 `public/og.png`(可用站点 logo + "Share HTML" 标题制作)。Vite 会把 `public/` 原样拷到 `dist/`。

- [ ] **Step 2: 在 `<head>` 加 og:image / twitter:image,并升级 twitter:card**

把现有 `<meta name="twitter:card" content="summary" />` 改为:

```html
    <meta name="twitter:card" content="summary_large_image" />
    <meta property="og:image" content="https://sharehtml.zhenjia.dev/og.png" />
    <meta name="twitter:image" content="https://sharehtml.zhenjia.dev/og.png" />
```

- [ ] **Step 3: 构建验证**

Run: `npm run build && test -f dist/og.png && echo "og.png shipped"`
Expected: 打印 `og.png shipped`。

- [ ] **Step 4: Commit**

```bash
git add public/og.png index.html
git commit -m "feat(seo): add og:image for social/AI previews"
```

---

## Task 8: A3 — 上传 UI 语义化

**Files:** Modify: `src/client/main.tsx`(`UploadPanel`,第 176、183 行附近)

- [ ] **Step 1: 给 form 和 file input 加 aria-label**

把 `<form className="upload-panel" onSubmit={submit}>`(第 176 行)改为:

```tsx
    <form className="upload-panel" onSubmit={submit} aria-label="Upload an HTML file to share">
```

把第 183–187 行的 file input:

```tsx
        <input
          type="file"
          accept=".html,.htm,text/html"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
```

改为:

```tsx
        <input
          type="file"
          accept=".html,.htm,text/html"
          aria-label="Choose an HTML file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 3: Commit**

```bash
git add src/client/main.tsx
git commit -m "feat(a11y): label upload form and file input for agents/AT"
```

---

## Task 9: B5 — DNS-AID 记录(DNS 配置,非代码)

> 需要 Cloudflare DNS 写权限,代码无法完成。DNS-AID 是较新提案,**实现前先查最新 spec 确认记录名与值格式**。

- [ ] **Step 1: 查 DNS-AID 规范的确切 TXT 记录格式**(WebSearch "DNS-AID DNS for AI Discovery spec TXT record")。
- [ ] **Step 2: 在 Cloudflare DNS 为 `zhenjia.dev`(及需要的子域)添加 DNS-AID TXT 记录**,值指向发现资源(llms.txt / openapi / mcp)。
- [ ] **Step 3: 验证**:`dig TXT <记录名>.zhenjia.dev +short` 返回预期值;随后用 Task 10 的 scan 确认 `dnsAid` 转 pass。
- [ ] **Step 4:** 无代码改动,无需 commit。

---

## Task 10: 最终验证 + 部署

- [ ] **Step 1: 全量测试 + 构建**

Run: `npm test && npm run build && npx wrangler deploy --dry-run`
Expected: 测试通过、构建成功、dry-run 通过。

- [ ] **Step 2: 走部署流程**

```bash
git push origin <branch>      # 开 PR
# PR 通过 CI Build → 合并 main → Cloudflare Workers Builds 自动部署
```

- [ ] **Step 3: 线上验证各项**

```bash
# A1 首页静态内容
curl -s https://sharehtml.zhenjia.dev/ | grep -c "Use it programmatically"   # 期望 1
# B1 auth.md
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://sharehtml.zhenjia.dev/.well-known/auth.md   # 200 text/markdown
# B2 A2A card
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://sharehtml.zhenjia.dev/.well-known/agent-card.json   # 200 application/json
# C 404 兜底
curl -s -o /dev/null -w "%{http_code}\n" https://sharehtml.zhenjia.dev/.well-known/nope   # 404
# A2 create_share via MCP
curl -s -X POST https://sharehtml.zhenjia.dev/mcp -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -c create_share   # >=1
```

- [ ] **Step 4: 重跑 isitagentready,确认 fail→pass**

```bash
curl -s -X POST https://isitagentready.com/api/scan -H "Content-Type: application/json" \
  -d '{"url":"https://sharehtml.zhenjia.dev"}' | python3 -m json.tool | grep -E "authMd|a2aAgentCard|dnsAid|level"
```
Expected: `authMd`/`a2aAgentCard` 状态为 `pass`;`dnsAid` 在 Task 9 完成后为 `pass`;`level` 维持 5。

- [ ] **Step 5:** 部署相关无新增 commit(改动已在前序 task 提交)。

---

## 备注:跳过项

- **B6 Web Bot Auth**:Share HTML 是被访问网站、非发起请求的 bot,该机制意义有限。判定 **N/A,跳过**。若坚持要其 neutral→pass,另起小 task 发布 `/.well-known/http-message-signatures-directory` 最小 JSON。
