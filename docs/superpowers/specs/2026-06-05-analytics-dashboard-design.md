# Analytics Dashboard for zhenjia.dev — 设计与实施 Plan

> 目标读者:负责实现的另一个 agent。本文档自包含,含已验证的事实(zone id、可用字段、约束),照此实施即可,无需重新摸索 Cloudflare API。
> 创建日期:2026-06-05

---

## 1. 目标

为域名 `zhenjia.dev`(及其子站点)构建一个**在线网页 analytics dashboard**,核心特性:**区分 bot 与 human 流量**,并按三个站点分别统计:

| 站点 | host | 备注 |
|------|------|------|
| 主站 | `zhenjia.dev` | 流量最大 |
| Share HTML | `sharehtml.zhenjia.dev` | |
| Litter Link | `link.zhenjia.dev` | 短链服务 |

> zone 下还有 `img` / `animalcrossing` / `yangyang` / `seichijunrei` 等子域。设计上 host 维度应可扩展到任意子域,但 dashboard 默认聚焦上述三个 + 一个 "All hosts" 汇总。

---

## 2. 已确认的产品决策(来自 brainstorming)

| 维度 | 决策 |
|------|------|
| 形态 | 在线网页 dashboard(非 CLI、非静态报告) |
| 部署 | 独立 Cloudflare Worker,建议绑定 `analytics.zhenjia.dev` |
| 鉴权 | **Cloudflare Access**(zero-trust,Google/邮箱登录),不写鉴权代码 |
| 数据策略 | **自建存储 + 每日 cron 抓取**,支持长期趋势(30/90 天) |
| 存储 | Cloudflare **D1**(SQLite),存按天聚合数据 |
| 数据源 | Cloudflare GraphQL Analytics API(token 存 worker secret,绝不入前端) |
| bot/human 区分 | `verifiedBotCategory` + User-Agent 启发式(免费版无 `botScore`) |

---

## 3. 架构总览

```
                ┌─────────────────────────────────────────┐
   每日 Cron ──▶ │  Worker: analytics.zhenjia.dev           │
                │                                           │
                │  ┌──────────────┐   ┌──────────────────┐ │
   浏览器 ─────▶ │  │ Fetch 层     │   │ Dashboard 层      │ │
   (经 CF Access)│  │ (cron)        │   │ (GET / → HTML)    │ │
                │  │ 抓 GraphQL    │   │ 读 D1 → 渲染图表   │ │
                │  └──────┬───────┘   └─────────┬────────┘ │
                │         │  写入              读取 │        │
                │       ┌─▼──────────────────────▼─┐       │
                │       │        D1 (SQLite)         │       │
                │       └────────────────────────────┘       │
                └─────────────┬─────────────────────────────┘
                              │ GraphQL (Bearer secret)
                              ▼
                  api.cloudflare.com/client/v4/graphql
```

三个逻辑模块,各自单一职责、可独立测试:

1. **Fetch/Ingest 模块**(cron 触发):查 Cloudflare GraphQL → 分类 bot/human → 聚合 → 写 D1。
2. **Query 模块**:从 D1 按 (日期范围 × host × 维度) 读聚合数据,供前端用。
3. **Dashboard/UI 模块**:`GET /` 返回 HTML;数据通过内部 JSON API(如 `GET /api/metrics?...`)或直接 SSR 注入。

---

## 4. 数据源:Cloudflare GraphQL Analytics(已验证)

- **Endpoint**: `https://api.cloudflare.com/client/v4/graphql`
- **认证**: HTTP header `Authorization: Bearer <CF_ANALYTICS_TOKEN>`
- **Account ID**: `021233c1880a43aa68565496100e1f8c`
- **Zone ID (zhenjia.dev)**: `b64b4605529604650367c58b8c6ab3ce`

### 4.1 Token(重要)

- 需要权限:**Account → Account Analytics → Read** + **Zone → Analytics → Read**(zone 选 zhenjia.dev)。已验证此组合可查 zone 级 `httpRequestsAdaptive(Groups)` 含 `clientIP`。
- ⚠️ brainstorming 过程中用过的临时 token 已在对话中暴露,**实现时必须新生成一个**,通过 `wrangler secret put CF_ANALYTICS_TOKEN` 存入 worker,**绝不写进代码或前端**。

### 4.2 已验证的字段可用性

| 字段 | 可用? | 用途 |
|------|-------|------|
| `clientRequestHTTPHost` | ✅ | 区分三个站点 |
| `clientCountryName` | ✅ | 地理分布 |
| `clientRequestPath` | ✅ | Top 页面 |
| `edgeResponseStatus` | ✅ | 状态码/错误率(含 504) |
| `userAgentBrowser` | ✅ | 浏览器分布 |
| `clientIP` | ✅(groups & raw 均可) | 独立访客估算 |
| `userAgent`（raw） | ✅ | UA 启发式 bot 分类 |
| `verifiedBotCategory`（raw） | ✅ | 已验证 bot(Googlebot 等) |
| `botScore` / `botManagement.*` | ❌ 付费 | **不可用**,勿依赖 |

### 4.3 硬约束（影响架构,务必遵守）

1. **单次查询时间范围 ≤ 1 天**:`httpRequestsAdaptiveGroups` 对该 zone 拒绝跨度 >1d 的查询。→ cron 每次只抓 **1 天**(抓"昨天")。Backfill 历史时按天循环。
2. **免费版原始数据保留期有限**(约数天)。→ 长期趋势**只能靠自建 D1 累积**;首次 backfill 最多回填保留期内的几天。
3. **GraphQL 变量名必须与 query 内 `$var` 完全一致**(否则报 `empty zone filters`)。
4. **不要无 filter 列举所有 zone**(报 `too many zones`),始终用固定 zone id。

---

## 5. bot / human 分类逻辑

免费版无 `botScore`,采用两级判定(优先级从高到低):

```
classify(record):
  1. if verifiedBotCategory 非空且非 "Unknown":
        → bot,且记录具体类别(Search Engine Crawler / AI Crawler / 等)
  2. elif UA 命中 bot 模式(见下):
        → bot(标记为 "unverified bot")
  3. else:
        → human
```

**UA 启发式 bot 模式**(大小写不敏感,正则 OR):
`bot|crawl|spider|slurp|curl|wget|python-requests|httpx|axios|headless|phantom|nginx-ssl|early hints|facebookexternalhit|gptbot|oai-searchbot|chatgpt-user|claudebot|claude-searchbot|perplexitybot|google-extended|bingbot|yandexbot|amazonbot|bytespider|ccbot|meta-externalagent`

**AI 爬虫专项子类**(从上面的 bot 里单独标出,用于 §8 的扩展视图):
`GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, Amazonbot, Bytespider, CCBot, meta-externalagent`

> 实测样本已确认这些 bot 真实存在于流量中(如 `Claude-SearchBot/1.0`、`YandexBot/3.0`、`curl/7.29.0`)。

> ⚠️ 分类必须在 **ingest 阶段**完成(查 raw `httpRequestsAdaptive` 拿到 `userAgent`/`verifiedBotCategory` 后分类,再聚合写入 D1)。因为聚合后的 `httpRequestsAdaptiveGroups` 无法事后区分 bot。这意味着 ingest 走 **raw 数据集**(`httpRequestsAdaptive`),自行在 worker 内聚合。

---

## 6. D1 Schema(建议)

按天 × host × 维度的聚合事实表。为控制行数,拆成几张针对性聚合表,而非一张超宽表。

```sql
-- 每天 × host × 流量类别 的总量(驱动"流量趋势"+"站点对比")
CREATE TABLE daily_traffic (
  day          TEXT NOT NULL,        -- 'YYYY-MM-DD' (UTC)
  host         TEXT NOT NULL,
  visitor_class TEXT NOT NULL,       -- 'human' | 'verified_bot' | 'unverified_bot'
  requests     INTEGER NOT NULL,
  uniq_ips     INTEGER NOT NULL,     -- 当天该切片的独立 IP 数
  PRIMARY KEY (day, host, visitor_class)
);

-- 每天 × host × 国家(驱动"地理分布")
CREATE TABLE daily_country (
  day TEXT, host TEXT, country TEXT, visitor_class TEXT,
  requests INTEGER NOT NULL,
  PRIMARY KEY (day, host, country, visitor_class)
);

-- 每天 × host × 路径 Top-N(驱动"Top 页面")
CREATE TABLE daily_path (
  day TEXT, host TEXT, path TEXT, visitor_class TEXT,
  requests INTEGER NOT NULL,
  PRIMARY KEY (day, host, path, visitor_class)
);

-- 每天 × host × 状态码(驱动"健康监控/错误率")
CREATE TABLE daily_status (
  day TEXT, host TEXT, status INTEGER, requests INTEGER NOT NULL,
  PRIMARY KEY (day, host, status)
);

-- 每天 × host × bot 类别(驱动"Top bots" + "AI 爬虫专项")
CREATE TABLE daily_bot (
  day TEXT, host TEXT, bot_name TEXT, is_ai INTEGER NOT NULL,
  requests INTEGER NOT NULL,
  PRIMARY KEY (day, host, bot_name)
);

-- ingest 记账,保证幂等 + 可观测
CREATE TABLE ingest_log (
  day TEXT PRIMARY KEY, fetched_at TEXT, rows_seen INTEGER, status TEXT
);
```

> Top-N 截断(如 path 每天每 host 取前 50)需在写入前完成,并 `log()`/记录被丢弃的尾部量,避免"看着像全量"。

---

## 7. Cron 抓取逻辑

- **触发**:`wrangler.jsonc` 配 `triggers.crons`,建议每天一次(如 UTC `0 2 * * *`,抓前一天 00:00–24:00 UTC)。
- **流程**(对"昨天"这一天):
  1. 分页拉取 raw `httpRequestsAdaptive`(`limit` 上限通常 10000;若单日量大需用游标/时间分片多次拉)。每条含 `clientRequestHTTPHost, clientIP, userAgent, verifiedBotCategory, clientCountryName, clientRequestPath, edgeResponseStatus, datetime`。
  2. 仅保留目标 host(三站点;可配置)。
  3. 逐条 `classify()`(§5)。
  4. 在内存聚合成 §6 各表的行(注意独立 IP 用 set 去重计数)。
  5. 事务写入 D1(先删该 `day` 旧行再插,保证**幂等**重跑)。
  6. 写 `ingest_log`。
- **Backfill**:一次性脚本/管理端点,对保留期内的过去 N 天循环执行上述流程(注意 1d/查询限制 → 每天一次查询)。
- **采样说明**:`httpRequestsAdaptive` 可能采样;如发现与 `httpRequests1dGroups`(全量计数)偏差大,可用后者校准"总请求数",raw 仅用于 bot/human 拆分比例。**dashboard 上需注明数据为"近似"**(no silent caps)。

---

## 8. Dashboard 视图

### 核心视图(用户已选,全部要)

1. **流量趋势** — 每天 human vs bot 请求数折线图(可切 host 或看 All)。数据源 `daily_traffic`。
2. **站点对比 + 地理分布** — 三站点请求量并排对比 + 各站点按国家 Top 列表/地图。数据源 `daily_traffic` + `daily_country`。
3. **明细排行** — Top 页面(`daily_path`)、Top bots(`daily_bot`)、独立访客估算(`daily_traffic.uniq_ips`)。
4. **健康监控** — 状态码分布 + 错误率(4xx/5xx 占比,**显式高亮 504**)。数据源 `daily_status`。

### 扩展视图(回应"还能不能有更多" — 建议实现,价值高)

5. **🤖 AI 爬虫专项**(强烈建议):GPTBot / ClaudeBot / PerplexityBot / Google-Extended 等 AI 爬虫的访问趋势与占比。直接回答"有没有 AI 在抓我的站、抓哪些站/页面"——与站点的 GEO/agent 可发现性目标强相关。数据源 `daily_bot WHERE is_ai=1`。
6. **浏览器 / 设备分布**(human 流量,`userAgentBrowser`)。
7. **新访客 vs 回访**(按 IP 在时间窗内首次出现估算)。
8. **高峰时段热力图**(若 ingest 改为存小时粒度;默认按天则跳过 — YAGNI)。

> UI 实现建议:单页 HTML,图表用轻量方案(Chart.js CDN 或纯 SVG,避免重前端栈)。顶部全局筛选:日期范围(7/30/90 天)、host(三站点 + All)、流量类别(All/Human/Bot)。

---

## 9. 鉴权与安全

- **Cloudflare Access**:在 Cloudflare Zero Trust 后台为 `analytics.zhenjia.dev` 建 Access 应用,策略限定为站长本人邮箱(Google/OTP)。Worker 本身不写登录逻辑;可选地在 worker 内校验 `Cf-Access-Jwt-Assertion` 头做二次防线。
- **Token**:`CF_ANALYTICS_TOKEN` 走 `wrangler secret`,仅 cron/后端使用,**永不下发前端**。
- **隐私**:`clientIP` 仅用于**后端去重计数**(`uniq_ips`),**不在 dashboard 展示明文 IP**(只展示聚合数)。如确需逐 IP 排查,另做受限的管理端点。
- D1 中不存原始 IP 明文(只存去重后的计数),降低存储侧隐私风险。

---

## 10. 实施步骤(给执行 agent,分阶段)

**Phase 0 — 脚手架**
- 新建独立项目/仓库(TypeScript + Wrangler)。`wrangler.jsonc`:worker 名、custom domain `analytics.zhenjia.dev`、D1 binding、`triggers.crons`。
- `wrangler secret put CF_ANALYTICS_TOKEN`(新生成的受限 token)。
- 建 D1 数据库 + 执行 §6 schema migration。

**Phase 1 — Ingest 模块**
- 实现 GraphQL 客户端(注意 §4.3 约束:1d 窗口、变量名、固定 zone id、分页)。
- 实现 `classify()`(§5)+ 内存聚合 + 幂等写 D1 + `ingest_log`。
- 单元测试:分类逻辑(给定 UA/verifiedBotCategory → 期望类别);聚合正确性。

**Phase 2 — Cron + Backfill**
- 接 `scheduled()` handler:每日抓昨天。
- Backfill 端点/脚本:回填保留期内历史。
- 验证:跑一次,D1 出现合理数据;重跑同一天不重复(幂等)。

**Phase 3 — Query API**
- `GET /api/metrics?from&to&host&class&view=...` 从 D1 读聚合,返回 JSON。

**Phase 4 — Dashboard UI**
- `GET /` 返回 HTML + 图表;实现 §8 核心 4 视图 + 扩展 AI 爬虫视图。
- 全局筛选(日期/host/类别)。

**Phase 5 — 鉴权 + 部署 + 验证**
- 配 Cloudflare Access。
- 部署,确认未登录被 Access 拦截、登录后可看。
- 对照 Cloudflare 官方 dashboard 抽查数字量级一致(注意采样导致的近似)。

---

## 11. 风险 / 约束 / 待定

- **数据近似**:raw 数据集采样 → 绝对值是估算。dashboard 需注明。必要时用 `httpRequests1dGroups` 全量计数校准总量。
- **首次历史有限**:免费版保留期外的历史拿不到,趋势从部署日起逐步累积。
- **单日量大时分页**:`zhenjia.dev` 主站日请求数千级,raw 拉取需处理分页/时间分片,避免漏数据或超时。
- **粒度**:默认按天聚合。若将来要"高峰时段热力图"需改存小时粒度(schema 加 hour 维度)——目前 YAGNI,不做。
- **成本**:全部在 Cloudflare 免费额度内(Worker + D1 + Cron + Access 免费层)。

---

## 12. 验收标准

- 经 Cloudflare Access 登录后可访问 `analytics.zhenjia.dev`,未登录被拦。
- 能按 7/30/90 天 × {三站点 + All} × {Human/Bot/All} 查看:流量趋势、站点对比、地理分布、Top 页面、Top bots、独立 IP 数、状态码/错误率、AI 爬虫专项。
- 每日 cron 自动累积新数据;重跑幂等。
- 前端不含任何 Cloudflare token;IP 明文不外露。
