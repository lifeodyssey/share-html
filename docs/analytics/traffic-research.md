# Share HTML traffic evidence — 2026-09-23

Read-only Cloudflare D1 queries succeeded after the existing Wrangler OAuth session refreshed. No credential values were read or published and no security configuration was changed. Snapshot: `/tmp/sharehtml-0923/traffic-aggregates.json`; query definitions: `/tmp/sharehtml-0923/traffic.sql`. The JSON contains only daily aggregates, bot names, status codes and explicitly allowlisted public routes, without IPs, share slugs, user titles or full URLs.

## What the stored observations show

Coverage for `sharehtml.zhenjia.dev`: 2026-06-03 through 2026-09-22 UTC, with host rows on 111 of 112 calendar days. 2026-08-25 has no host row despite a successful overall ingest; show a gap, not a confirmed zero. The ingest log spans May 29–September 22: five failed days (May 29–June 2) and 112 successful days across all ingested zones/hosts. September 23 is not yet a completed historical day.

| Classification | Stored observations |
| --- | ---: |
| All mutually exclusive base classes | 70,340 |
| Unmatched / legacy `human` fallback | 49,709 |
| Unverified bot heuristic | 17,612 |
| Cloudflare verified bot category present | 3,019 |
| Legacy AI user-agent subset, overlapping the above | 1,852 |

The fallback label does **not** establish that 49,709 requests came from humans. The AI subset must never be added to base totals. UA names can be spoofed; named-bot counts do not independently establish the operator's identity. The legacy AI-name list is incomplete: e.g. Google-CloudVertexBot (131), DeepSeekBot (99), and xAI-SearchBot (83) appear as non-AI named bots in storage.

| Named bot / UA | Observations |
| --- | ---: |
| Claude-SearchBot | 588 |
| OAI-SearchBot | 382 |
| ClaudeBot | 309 |
| WebMCPIndexBot | 265 |
| Googlebot | 250 |
| Bingbot | 169 |
| ChatGPT-User | 150 |
| GPTBot | 126 |
| CCBot | 126 |
| PerplexityBot | 124 |

Public discovery-route base counts, excluding the overlapping AI slice: `/robots.txt` 1,162; `/sitemap.xml` 475; `/llms.txt` 70; `/.well-known/agent-card.json` 50; `/auth.md` 9; `/mcp` 108. The homepage has 3,639 stored base observations. These counts demonstrate observed requests; they do not establish successful discovery, tool execution, indexing, citations or new customers. A GET/probe/error at `/mcp` is not evidence of a completed MCP call.

Status observations include 30,904 HTTP 200, 1,162 HTTP 201, 21,524 HTTP 404 and 10,478 HTTP 504. Therefore total-request growth cannot be described as successful product adoption. No status-by-bot join was retrieved, so do not assign these errors to named bots.

## Sampling and retention limits

The existing analytics collector reads Cloudflare `httpRequestsAdaptive`, with `datetime_ASC` and a configured 10,000-record limit per query window. Current repository configuration uses a 24-hour window, and zone auto-discovery can combine multiple zones. The collector increments each returned row by one and does not request or apply sampling weights. Treat all numbers as **stored observations**, not complete or statistically corrected traffic counts.

Reaching a query cap can favor earlier requests in a window. The persisted ingest log is combined across zones and does not record each window's cap/sampling diagnostics: 35 days have at least 10,000 combined rows, but that alone cannot prove exactly which windows were capped. Do not equate those 35 days to confirmed capped days. Even counts below 10,000 do not prove completeness.

Daily paths retain only the top 50 per host/class; bot paths retain the top 100 per host/bot. Route totals may omit observations. Daily unique-IP values are unsuitable for a cross-day unique-user count and were intentionally omitted from this export.

Implementation evidence: analytics repository `src/analytics-worker/graphql.ts`, `aggregate.ts`, `classify.ts`, `ingest.ts`, and `wrangler.jsonc` inspected on September 23. This documents current collector semantics; historical configuration stability was not established.

## Timeline and comparison boundary

Git history confirms discovery/SEO-related changes on May 26, agent-readiness changes June 6 (`52753a0`), and private sharing / agent discovery July 19 (`2029c4a`), followed that day by MCP endpoint and registry changes. Commit timestamps are not release timestamps.

Read-only `wrangler deployments list --json` returned the most recent ten production Worker deployments, from July 18 20:23 UTC through July 19 04:44:31 UTC. July 19 has production deployment evidence, but the limited deployment listing does not independently confirm the May/June release dates or map each July deployment to a specific commit. Snapshot: `/tmp/sharehtml-0923/deployments.json`.

| Descriptive interval (UTC) | Host-data days | Base observations | Legacy AI subset |
| --- | ---: | ---: | ---: |
| June 3–5 | 3 | 1,175 | 19 |
| June 6–July 18 | 43 | 4,014 | 244 |
| July 19–September 22 | 65 | 65,151 | 1,589 |
| August 24–September 22 | 29 | 60,101 | 1,004 |

These unequal intervals and uncertain sampling coverage cannot establish a causal effect of agent-readiness work. May 26 lacks a measured pre-change baseline. June 6 has only three earlier observed days, and July 19 bundled multiple product/discovery changes. Increased observations are compatible with scans, errors, testing, collection changes, discovery or use; attribution remains unresolved.

## Official interpretation references

- [GA4 known bot exclusion](https://support.google.com/analytics/answer/9888366): GA4 automatically excludes known bot traffic; this cannot be disabled and excluded volume is not exposed. GA4 therefore cannot serve as a complete crawler request ledger.
- [GA4 traffic-source dimensions](https://support.google.com/analytics/answer/11242870): browser acquisition attribution describes how collected traffic arrived. An AI referral and an AI crawler request are different signals; absent/referrer-stripped browser visits cannot reliably be reconstructed as AI referrals.
- [Cloudflare GraphQL sampling](https://developers.cloudflare.com/analytics/graphql-api/sampling/): sampling applies to analytics datasets and must be accounted for when interpreting counts.
- [Cloudflare verified bots](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/): verified bot categories describe recognized services and purposes, separately from a site's local user-agent heuristic.
- [OpenAI crawler roles](https://developers.openai.com/api/docs/bots): OAI-SearchBot supports search, GPTBot supports model development, and ChatGPT-User handles certain user-triggered visits. Their request counts should not be merged into a single claim of autonomous product use.

Future telemetry should separately retain edge requests/discovery probes, actual MCP methods and outcomes, upload/share completion, and browser acquisition/referral. Historical traffic alone cannot reconstruct those missing business outcomes.
