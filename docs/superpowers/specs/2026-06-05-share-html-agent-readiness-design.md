# Share HTML — Agent 可发现/可用性增强 设计文档

> 目标:在已达 isitagentready「Level 5 / Agent-Native」的基础上,补齐真正影响"agent 能用上你"的高价值项 + 刷满评分维度。
> 范围(用户已确认):**全做** = 高价值 3 项(A) + 评分维度(B) + 根因修复(C)。
> 创建日期:2026-06-05 | 目标读者:实现 agent / 本人

---

## 0. 现状(已验证)

- isitagentready 实测:**Level 5 / Agent-Native**,12 pass / 3 fail / 6 neutral。
- 已具备:robots.txt(含 AI bot 规则)、sitemap、Link headers、llms.txt、markdown content negotiation、MCP server card、`/mcp` 端点、WebMCP(2 个**只读**工具)、agent-skills、api-catalog、OAuth/OIDC、security.txt、OpenAPI(5 路径 6 操作,含 `POST /api/shares` 上传)。
- 3 个 fail:`dnsAid`、`authMd`、`a2aAgentCard`。
- 交叉验证额外缺口:无 JSON-LD、**首页是 SPA 空壳**、无 og:image、未定义 well-known 路径全部落 SPA fallback(200 HTML 假阳性)。

**关键文件**:`index.html`(首页 + inline WebMCP)、`src/worker/index.ts`(路由 + llms.txt/well-known/MCP/上传)、`src/client/main.tsx`(React app + 上传 UI)。

---

## A. 高价值项(真正影响"agent 能用上你")

### A1. 首页给 agent 可读的静态内容(最高优先)

**问题**:agent fetch `https://sharehtml.zhenjia.dev/` 得到的 `<body>` 只有 `<div id="root"></div>`(空壳),不执行 JS 的 agent 读不到任何"是什么/怎么用"。

**方案**:把静态内容直接写进 `index.html` 的 `#root` 内。React `createRoot().render()` 挂载时会清空并替换它 —— 真人无感,agent fetch 即读到。

```html
<div id="root">
  <main>
    <h1>Share HTML — upload one HTML file, get a sandboxed shareable link</h1>
    <p>Upload a single self-contained HTML file and get a public, sandboxed preview URL. No signup required (anonymous uploads kept 365 days).</p>
    <h2>Use it programmatically</h2>
    <pre>curl -X POST https://sharehtml.zhenjia.dev/api/shares -F "file=@page.html" -F "title=My page"
# → JSON: { share: { share_url, preview_url, slug, id }, claimToken }</pre>
    <p>Full API: <a href="/openapi.json">/openapi.json</a> · AI guide: <a href="/llms.txt">/llms.txt</a></p>
  </main>
</div>
```

**验收**:`curl https://sharehtml.zhenjia.dev/` 的 body 含上述文字;真人访问 UI 正常。

### A2. 给 MCP 加 `create_share` 工具(让 agent 能真正"用",不只是读)

**问题**:WebMCP(`index.html` inline)和 `/mcp`(worker)目前只暴露 `describe_share_html` + `get_public_share`(都只读)。agent 发现了也无法执行核心动作"上传 HTML 拿链接"。

**方案**:两处都加 `create_share` 工具。

- **输入 schema**:`{ html: string (required, the HTML document), title?: string }`
- **行为**:构造 `FormData`(`file` = `new Blob([html], {type:"text/html"})`,`title`),`POST /api/shares`(匿名)。
- **输出**:`{ share_url, preview_url, slug, id, claimToken }`(原样返回上传响应)。
- **工具描述**(关键 — 让 agent 语义匹配到):`"Publish/host/share a single HTML page. Uploads an HTML document and returns a public sandboxed shareable URL. Use when the user wants to share, host, or get a link for an HTML file/page."`

实现位置:
1. `index.html` inline `navigator.modelContext.provideContext` 的 `tools` 数组加一项(execute 里 `fetch("/api/shares", {method:"POST", body: formData})`)。
2. `src/worker/index.ts` 的 `/mcp` tools/list + tools/call:加 `create_share`,内部复用上传逻辑(见下方重构说明)。

**重构说明**:当前上传逻辑在 worker 的 share-create handler 里(约 `index.ts:737–828`,读 `form.get("file")`)。为让 `/mcp` 复用,把"校验+扫描+写 R2+写 DB"抽成一个接受 `(html: string, title: string, user: AuthUser|null)` 的内部函数 `createShareRecord(...)`,HTTP handler 和 MCP handler 都调它。避免逻辑重复。

**验收**:`POST /mcp` 调 `tools/list` 含 `create_share`;调 `tools/call create_share` 能真实创建并返回 URL。

### A3. 上传 UI 对 browser-agent 友好(小改)

现状已不错(`<label className="field">`、`aria-live`、按钮文字 "Create share")。补强:
- 给 `<form className="upload-panel">` 加 `aria-label="Upload an HTML file to share"`。
- dropzone 的 `<input type="file">` 加 `aria-label="Choose an HTML file"`(目前靠相邻 span 文字,显式 label 更稳)。
- 给主上传区 `<section className="upload-surface">` 已有 `<h1>`,语义足够;无需大改。

**验收**:用 browser/computer-use agent 跑"上传一个 HTML 并拿链接",能自主找到文件框→选择→点 "Create share"→读出结果链接。

---

## B. 评分维度补齐

### B1. `auth.md`(fail → pass)

worker 加路由 `GET /.well-known/auth.md`(也可同时挂 `/auth.md`),返回 `text/markdown`,内容描述认证模型:
- 匿名上传:无需认证(`POST /api/shares` 直接调)。
- 已登录:Supabase OTP magic-link;API 调用带 `Authorization: Bearer <supabase_access_token>`。
- 列出受保护端点(列出/删除/claim 需登录)。

参照现有 `llms.txt` / well-known 路由的写法(`index.ts` 内 `textResponse(...)`)。

### B2. A2A Agent Card(fail → pass)

worker 加路由 `GET /.well-known/agent-card.json`,返回 `application/json` 的 A2A Agent Card。最小可用结构:
```json
{
  "name": "Share HTML",
  "description": "Upload one HTML file and get a public sandboxed shareable preview link.",
  "url": "https://sharehtml.zhenjia.dev",
  "version": "1.0.0",
  "capabilities": { "streaming": false },
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],
  "skills": [
    { "id": "create_share", "name": "Create share", "description": "Upload an HTML document, return a public shareable URL.", "tags": ["html","hosting","share"] },
    { "id": "get_public_share", "name": "Get public share", "description": "Fetch public metadata for a share slug.", "tags": ["metadata"] }
  ]
}
```
> 字段以 A2A 最新 spec 为准(本结构覆盖 isitagentready 的「返回 JSON」检测;实现后重跑 scan 验证)。

### B3. JSON-LD 结构化数据(交叉验证缺口)

`index.html` `<head>` 加:
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
  "potentialAction": {
    "@type": "CreateAction",
    "target": "https://sharehtml.zhenjia.dev/api/shares"
  }
}
</script>
```

### B4. og:image(交叉验证缺口)

- 准备一张 OG 图(1200×630,可用 logo + 标题生成,放 `public/og.png`)。
- `index.html` 加 `<meta property="og:image" content="https://sharehtml.zhenjia.dev/og.png">` + `<meta name="twitter:image" ...>`,并把 `twitter:card` 改为 `summary_large_image`。

### B5. DNS-AID(fail → pass;这项是 DNS 配置,非代码)

DNS for AI Discovery:在 Cloudflare DNS 为 `zhenjia.dev` / `sharehtml.zhenjia.dev` 加 TXT 入口记录,指向发现资源(llms.txt / openapi / mcp)。
- ⚠️ DNS-AID 是较新提案,**确切记录名与格式以最新 spec 为准**;实现时先查 spec,再用 isitagentready 重跑确认 `dnsAid` 转 pass。
- 这步需要你(或有 DNS 写权限的 token)在 Cloudflare DNS 操作,代码无法完成。

### B6. Web Bot Auth(neutral;**很可能 N/A**,诚实标注)

Web Bot Auth 是让**发起请求的 bot** 用 HTTP Message Signatures 证明身份的机制(发布 `/.well-known/http-message-signatures-directory`)。Share HTML 是**被访问的网站**、不是主动发请求的 bot,**这一项对它意义有限**。
- 选项:发布一个最小的签名目录 JSON 让该检测变 neutral→pass(纯刷分),或**判定 N/A 跳过**(推荐,避免维护无用密钥)。
- 建议:跳过,除非重跑 scan 后你坚持要这一项变绿。

---

## C. 根因修复:well-known 未匹配路径不要落 SPA fallback

**问题**:`wrangler.jsonc` 的 `not_found_handling: single-page-application` 导致任何未被 worker 显式处理的路径(如 `/auth.md`、`/.well-known/agent-card.json` 在加之前)返回 `index.html`(200 HTML)。这正是 `authMd`/`a2aAgentCard` 报"returned HTML instead of JSON/Markdown"的根因,也会让 `/AGENTS.md`、`/ask` 等出现假阳性 200。

**方案**:在 worker 路由层,对 `/.well-known/*` 和已知 agent 资源路径,未命中时**显式返回 404**(而非交给 assets SPA fallback)。即:在 `index.ts` 现有 well-known 路由组末尾,对 `url.pathname.startsWith("/.well-known/")` 的漏网请求 `return new Response("Not found", {status:404})`。

---

## D. 验收闭环(每项做完都能自测)

我们已验证 isitagentready 有可用扫描 API:
```bash
curl -s -X POST https://isitagentready.com/api/scan \
  -H "Content-Type: application/json" -d '{"url":"https://sharehtml.zhenjia.dev"}' | python3 -m json.tool
```
- 部署后重跑,确认 `authMd` / `a2aAgentCard` / `dnsAid` 从 fail → pass。
- A1 用 `curl https://sharehtml.zhenjia.dev/` 看 body 是否含静态说明。
- A2 用 `POST /mcp` tools/list / tools/call 验证 `create_share`。

---

## E. 实施顺序(按价值降序)

1. **A1 首页静态内容**(纯 `index.html`,改动小、价值最高)
2. **C 根因修复**(worker well-known 404 兜底,解锁 B1/B2 不被 SPA 覆盖)
3. **B1 auth.md + B2 A2A card**(worker 加两个路由)
4. **A2 create_share**(WebMCP inline + `/mcp` + 抽 `createShareRecord` 重构)— 工作量最大
5. **B3 JSON-LD + B4 og:image**(`index.html` head + 一张图)
6. **A3 UI 语义化小改**(`main.tsx`)
7. **B5 DNS-AID**(你在 DNS 配置)
8. **B6 Web Bot Auth**(默认跳过,N/A)
9. 全部完成 → 重跑 isitagentready + 交叉自测

---

## F. 不确定项 / 风险

- **A2A card / DNS-AID / Web Bot Auth 是新标准**,确切格式可能演变;以"重跑 isitagentready 转 pass"为事实验收标准。
- **A2 create_share** 让匿名上传可被任意 agent 程序化触发 → 注意它已有的速率限制(匿名 10 次/小时,`index.ts:1058`)与风险扫描器仍然生效,**不要绕过这两道防线**;create_share 必须走与 HTTP 上传相同的 `createShareRecord`(含扫描 + 限流)。
- 部署仍走现有流程:PR → CI Build → 合并 main → Cloudflare Workers Builds 自动部署。

---

## G. 验收标准

- isitagentready 重扫:3 个 fail 全部转 pass(Web Bot Auth 视决定可保持 neutral)。
- `curl /` body 含产品说明 + curl 示例。
- `/mcp` 暴露并可成功调用 `create_share`(经扫描+限流,返回真实链接)。
- 真人 UI、现有功能零回归(`npm test` + `npm run build` 通过)。
