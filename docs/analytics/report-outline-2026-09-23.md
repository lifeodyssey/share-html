# 0923 report — questions, charts, and milestones

Status: approved by the user on September 24, 2026; bilingual redesign and publication in progress. Historical cutoff remains September 23, 2026.

## Purpose

Explain what people and agents use Share HTML to produce, where the increase in creation activity appears, and what evidence exists for changes following SEO, GEO, WebMCP, and remote MCP work. Keep observed behavior, inferred purpose, and unmeasured outcomes distinct.

The main reading path is: **what drives creation growth → which artifacts get opened → immediate previews versus sustained content activity → product-site versus shared-content traffic → acquisition clues and release effects**. The owner explicitly asked for substantive product findings, not a catalogue of measurement limitations. Each section leads with a supported judgment, quantitative evidence and an action; uncertainty follows beside the relevant evidence.

## Questions and proposed visuals

| Question / bilingual section title | Main visual | Supporting visual | What can be answered now |
| --- | --- | --- | --- |
| 1. 创建量何时开始增长？ / When did creation activity grow? | Daily creations with a 7-day moving average and milestone markers | Equal-window columns for July 1–23, August 1–23, September 1–23 | Complete frozen record counts, including the last partial day. Records are not people. |
| 2. 增长来自哪些创建入口？ / Which creation sources grew? | Weekly stacked columns by recorded source | Monthly 100% composition bars | Historical `api`, `mcp`, `direct`, other, and missing labels. These are supplied labels, not verified identity or acquisition channels. |
| 3. 用户拿 HTML 做什么？ / What are people making? | Ranked purpose bars, keeping unclassified artifacts visible | Six anonymized use-case cards plus a category-by-source heatmap | Static analysis of all 2,453 unique active public artifacts; 45.7% rule-matched, 54.3% unclassified. Private contents excluded. |
| 4. 是怎样的使用方式？ / What usage patterns appear? | Exact-content repeat-group size distribution | Public/private monthly composition | Repeated content and privacy choices. These do not establish returning people, retention, or a user's motivation. |
| 5. 浏览量和操作使用量如何变化？ / How did content access and product use change? | Timestamped daily application operations and content requests | First-request delay, fixed seven-day follow-up, head-content concentration | Historical `share_events` retain timestamps. Distinguish 14,969 period requests from 14,939 requests on the creation cohort; compare mature content cohorts, not user retention. |
| 6. 主站、分享内容各有多少访问，来源是什么？ / How are product-site and shared-content visits distributed and referred? | Separate Cloudflare RUM page-load estimates by page category | Referrer clues and request-egress countries | Sampled browser-source history exists. Instagram/Gmail clues lead to shared content, while product-page acquisition is largely direct-or-unknown. Internal route requests belong in the technical appendix. |
| 7. 改动何时上线，之后发生了什么？ / When were changes released, and what followed? | Verified release markers plus equal-window before/after panels | Source growth contributions, API concentration and MCP follow-up | Machine contact rises after July 19 without immediate creation growth; API growth is concentrated after September 10. Describe these observations without claiming isolated causal lift. |

The main page should show roughly 8–10 primary visuals. Supporting distributions and methodology can sit behind an expand control. Choose each visual for its question; do not add a map without location data, a retention chart without identities, or a conversion funnel without connected events.

Each chart needs a question as its heading, a plain-language takeaway, an explicit unit and denominator, and a short evidence note. A tooltip and accessible data table supply detail. Missing days remain gaps, not zeroes. A recorded zero and a metric that was never collected must have different labels.

## SEO, GEO, and tool-use evidence chains

| Track | Evidence chain | Current historical boundary |
| --- | --- | --- |
| SEO | Search crawler requests → search impressions/clicks → arriving browsers → successful creation | Crawler observations available; no Share HTML Search Console or GA history has been collected for this report. Crawls do not prove indexing or acquisition. |
| GEO | AI-service requests → citations or AI referrals → arriving browsers → successful creation | Some bot/user-agent and discovery requests available; citations and attributable conversions are not measured. |
| WebMCP | Browser capability and tool registration → actual tool invocation → result → successful creation | Dedicated historical call telemetry missing. `source=webmcp` absence cannot establish no usage. |
| Remote MCP | Machine connection/initialization → tool call → creation result | Historical supplied `mcp` creation labels available. Dedicated server event instrumentation is prepared but not yet deployed. |

The release adds consented WebMCP capability/registration, tool-call and result events, alongside separately verified remote MCP handler events. Browser WebMCP events remain client self-reports, and no per-call identifier joins concurrent calls to individual results or uploads. Describe these as prospective measurement stages, not an already observed end-to-end conversion funnel.

## Product milestones

All times below are Asia/Taipei (UTC+8). These are verified local Git history dates unless explicitly stated otherwise.

| Date | Change | Evidence and annotation |
| --- | --- | --- |
| May 26, 11:53 | SEO canonical/Open Graph/robots/sitemap; llms.txt, OpenAPI, discovery metadata | `84ec3d1`. Code change; production release time unverified. |
| May 26, 14:27 | Browser WebMCP read-only tools and remote MCP read-only endpoint | `6fd9fbe`. Separate the two transports. Code change; production release time unverified. |
| May 26, 14:33 | Sitemap restricted to the indexable homepage | `8b30184`. Supporting detail, not a major headline milestone. |
| June 6, 02:59:16 | Static indexable homepage, WebApplication structured data, auth/A2A discovery; WebMCP and remote MCP gain create_share | `52753a0`, PR #2. Exact SHA/version production build completion confirmed; several changes together. |
| July 19, 10:15:43 | Private sharing, four crawlable product pages, expanded agent discovery; WebMCP uploads gain a source label | `2029c4a`, PR #8. Exact SHA/version joined to 100% production deployment. |
| July 19, 10:33:58 | Published remote MCP address moves to workers.dev | `8f1d741`, PR #10. Exact SHA/version joined to 100% deployment. Main-host observations do not cover all machine-origin calls. |
| July 19, 12:44:12 | MCP Registry identity code changes to dev.zhenjia | `1c4c6f4`, PR #11. Exact SHA/version joined to Worker deployment; distinct from external Registry publication. |

The original May 26 deployment times were not recovered; those changes are included by the verified June 4 production build. June 8, June 16 and June 20 changes also have exact-SHA production-build evidence. June build completion timestamps do not invent second-level traffic switches. The owner reports no promotion during the study period; no promotional milestone is fabricated.

Use different visual markers for code changes and confirmed production deployments. Do not label any single date as “GEO became effective.”

## Measurement milestones

These belong on a second timeline lane rather than being presented as product releases.

- June 3: first saved Cloudflare host observations; no measured baseline before the May SEO work.
- July 1: start of the requested creation-record analysis window.
- July 21: first non-empty source in the frozen creation snapshot; earlier missing labels are not evidence of missing usage.
- August 10: first observed `mcp` creation label; not the MCP launch date.
- August 25: missing Cloudflare host day; retain a gap even though creation records exist that day.
- September 22 UTC: last complete day in the historical edge export.
- September 23, 23:27:28: frozen creation/content-request-counter cutoff. Later research fetches are excluded from those counters.
- New dedicated Share HTML GA4 stream and server analytics: prospective observation only; label the actual deployment/first verified event time once observed. Blog analytics stay excluded.

## Bilingual and reading design

- User refinements: plain white background, strong contrast, explicit axis labels and units on every Cartesian chart. Sankey and nested-state diagrams explain stage and width/length encodings instead of inventing Cartesian axes. Use direct labels and numeric values so colour is not the only cue.
- Scientific-figure references checked September 24: [Nature figure specifications](https://research-figure-guide.nature.com/figures/preparing-figures-our-specifications/) for labelled axes, ticks, accessible colour and legible text; [Matplotlib colormap guidance](https://matplotlib.org/stable/users/explain/colors/colormaps.html) for categorical versus ordered colour encodings.
- Chinese / English toggle translates the full page: questions, takeaways, axes, legends, tooltips, case descriptions, limits, and methodology.
- Default Chinese, preserve the selected language in navigation/export where practical.
- Shared data and definitions across both languages; keep product names and protocol identifiers consistent.
- A short first screen explains the three main questions, the analysis cutoff, and the strongest supported findings. Statistical details move beside their relevant chart or into the methods appendix.
- Public output contains anonymous aggregates and paraphrased cases; no raw titles, share links, identifiers, private HTML, or purported individual identities.

## Existing evidence

Design guidance read for this revision: Anthropic's [data-visualization](https://github.com/anthropics/knowledge-work-plugins/blob/main/data/skills/data-visualization/SKILL.md) and wshobson's [data-storytelling](https://github.com/wshobson/agents/blob/main/plugins/business-analytics/skills/data-storytelling/SKILL.md). Skills were read as guidance; no additional plugin or global skill installation was needed.

Analysis review also follows Anthropic's [explore-data](https://github.com/anthropics/knowledge-work-plugins/blob/main/data/skills/explore-data/SKILL.md) and [validate-data](https://github.com/anthropics/knowledge-work-plugins/blob/main/data/skills/validate-data/SKILL.md) guidance for record grain, missingness, independent recalculation and evidence limits. The user clarified that direct HTML opens count alongside embedded loads; public chart wording uses “内容访问请求 / content requests” throughout.

- [Historical methodology](./2026-09-23-report-methodology.md)
- [Cloudflare coverage and interpretation](./traffic-research.md)
- Additional user question: discovery channel, request geography, and simple usage profiles. Existing D1 country aggregates support a country/region request-origin chart with actor-class separation; these are not residents or nationality. Historical referral/UTM attribution was not collected. Artifact-based usage profiles may describe tasks but must not infer personal demographics.
- Frozen aggregates: `/tmp/sharehtml-0923/report-aggregates.json` and `/tmp/sharehtml-0923/traffic-aggregates.json` (local research files, not public assets).
