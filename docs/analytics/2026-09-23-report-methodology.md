# Share HTML 2026-09-23 usage report: method and coverage

This note documents the static report at `public/report/0923/index.html`. It is the durable, reproducible basis for the figures shown there. The report is an aggregate analysis of records and public HTML artifacts; it is not a count of people, customers, or successful agent sessions.

## Measurement window and record snapshot

The frozen share-record snapshot begins 2026-07-01 and ends at 2026-09-23 15:27:28.147672 UTC (2026-09-23 23:27:28 Asia/Taipei). It contains 2,797 rows: 2,659 `public_unlisted` and 138 `private_link`. Current status at the snapshot was 2,778 `active`, 10 `needs_review`, 7 `failed`, and 2 `uploading`. There are 2,786 `created_event` rows and 11 without that event. Event coverage and current status are separate measures.

| Taiwan calendar month | All rows | Public unlisted | Private link | Active | Created events | Calendar days observed | Rows/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| July | 34 | 34 | 0 | 34 | 34 | 31 | 1.10 |
| August | 725 | 695 | 30 | 724 | 725 | 31 | 23.39 |
| September through 23:27 on the 23rd | 2,038 | 1,930 | 108 | 2,020 | 2,027 | 23 | 88.61 |

For equal-length comparison, July 1–23 had 30 rows (1.30/day), August 1–23 had 410 (17.83/day), and September 1–23 had 2,038 (88.61/day). September is not a complete calendar month, though the snapshot ends only about 33 minutes before midnight Taiwan time on the 23rd.

The optional `source` values are call-site supplied labels: `api` 1,497; `mcp` 1,132; `direct` 111; other labels 17; and missing 40. `direct` denotes the web UI path when no other source was provided; it is not a referrer. Labels do not prove who initiated an operation: `api` is not proof of human use, and `mcp` is not proof of ChatGPT or of a particular agent. Non-null source labels first appear on July 21; July has 29 of 34 rows with a missing source. The first observed `mcp` creation label is August 10; that does not establish the MCP launch date.

## Public artifact coverage and classification

The classifier input is the set of unique `content_hash` values represented by active public shares. All 2,453 targets were retrieved successfully over HTTP (2,453/2,453, HTTP 200); there were no failed public fetches. The response bodies total 283,960,078 bytes. Requests used the explicit `ShareHTML-Research/2026-09-23 (+frozen-report-study)` user-agent and bounded concurrency of four. No private-link HTML was requested. Raw response files and fetch logs remain in the temporary research directory `/tmp/sharehtml-0923/`; none are tracked by Git or included in the report.

The frozen record snapshot was taken before the research GETs. Those later requests can increment live content-request counters, so they are not joined back into the frozen view counts. In 2,081 responses, the body was exactly 1,305 bytes larger than the stored `size_bytes`, consistent with Cloudflare-added response scripts. The parser removes only two recognizable Cloudflare script blocks before static parsing. It never executes uploaded scripts, loads page resources, or treats page content as instructions. This response-size caveat does not change the frozen snapshot values.

Classification is a deterministic, single-label reading aid. It uses the document title, social metadata, H1–H3 headings, visible text, and limited HTML cues. Title/meta/headings contribute three points per matching phrase; body text contributes at most two points per phrase. Scores below three and unresolved top-score ties remain `未分类`. A short generic test title can be assigned to `测试与占位`. Categories are inferred artifact purposes, not user-declared intent. “Rule match strength” is a relative rule signal, not calibrated semantic confidence.

| Inferred category | Unique active public HTML |
| --- | ---: |
| Unclassified | 1,333 |
| Reports and research | 298 |
| Games and interactive stories | 261 |
| Tests and placeholders | 135 |
| Learning and teaching | 117 |
| Interactive tools and mini-apps | 99 |
| Articles and guides | 72 |
| Data and visualization | 54 |
| Product and promotional pages | 44 |
| Personal wishes and expression | 23 |
| Operations status boards | 7 |
| Portfolios and personal pages | 4 |
| Events and invitations | 4 |
| Presentations and proposals | 2 |
| **Total** | **2,453** |

The resulting rule coverage is 1,120/2,453 (45.7%); 1,333/2,453 (54.3%) remain unclassified. Rule updates added multilingual teaching, calculator/planner, game, personal-message, and test/prototype phrases based in part on a non-random manual review of 90 unclassified samples. That review deliberately included large title-cluster examples and language-stratified cases; it is not a random sample and cannot estimate population prevalence. Some pages expose little text in static HTML, use only a brand name, declare a mismatched `lang`, or require browser execution. Those remain unclassified unless the static evidence supports a rule. No one read all 2,453 pages manually.

The category-by-source table uses 2,640 active public share rows (the same 2,453 unique artifacts with repeat links preserved). The remaining 19 public rows are non-active and excluded from the content matrix; they are included in the full population and status totals. A month-filtered category count is the number of unique hashes appearing among active public shares created in that month. The same hash may therefore occur in more than one month's unique count. The table's source columns are still self-reported labels.

### Page structure and language cues

Static page structure was extracted for each fetched artifact. The report highlights documents containing a `<form>` (113), `<button>` (1,289), or `<canvas>` (416). These counts mean the element appeared in the returned HTML; they do not verify behavior. Other retained aggregate checks include input/select/textarea, links, SVG, media and iframe tags, script tags, and a conservative library-name match against script source or inline text. For example, static substring matches included Vue in 211 documents, HTMX in 112, Chart.js in 46, and Tailwind in 42. A name match does not prove a library ran or powered the visible page.

Of 2,453 documents, 2,019 declared an `html lang` value, 432 had no accepted declaration and were assigned a fallback, and 2 had a script-based non-Latin writing-system cue. These are markup/text signals, not verified language proficiency, user location, ethnicity, or nationality. A declared `en` value may describe a page whose visible text is in another language. The report therefore does not use language as a geographic or demographic proxy.

## Repeats, privacy mode, and content requests

Among all 2,659 public share rows, exact-content comparison found 2,466 unique hashes, 82 hash groups repeated at least twice, 275 rows in those groups, and 193 rows beyond one row per unique hash. Exact hash detects byte-identical content only. A separate title normalization counted 1,437 non-empty patterns, of which 263 occur at least twice; those groups contain 1,485 rows. The largest single normalized pattern has 187 rows and the five largest have 472 rows. Empty normalized fingerprints are excluded (zero rows in this snapshot). These are anonymous pattern sizes, not user or customer counts; title similarity does not prove identical content.

Private-link shares account for 138/2,797 rows (4.93%): zero in July, 30/725 (4.14%) in August, and 108/2,038 (5.30%) through the September cutoff. This supports retaining an understandable privacy choice, but the observed share does not reveal why it was chosen or who chose it.

The frozen per-share content-request counters total 14,939 requests. A count above zero appears on 1,377/2,797 rows (49.2%); the median is zero, p90 is 10, p95 is 16, p99 is 42, and the maximum is 1,723. These are cumulative request counters on each share as of the snapshot. Both embedded iframe loads and direct document opens use the same HTML endpoint and increment the historical `viewed` counter; their contexts were not recorded separately. Repeated requests, bots and people may all contribute; they cannot be converted to unique readers. Monthly view totals are grouped by share creation month, not by the month when requests occurred.

## Cloudflare edge observations

Stored observations for `sharehtml.zhenjia.dev` cover 2026-06-03 through 2026-09-22 UTC, 111 of 112 calendar days. 2026-08-25 is absent from the host data despite an overall ingest that day; the missing host row is not treated as zero. The edge window differs from the July–September share-record snapshot.

The 70,340 stored base observations are mutually exclusive stored labels: 49,709 unmatched/legacy `human` fallback, 17,612 unverified-bot heuristic, and 3,019 Cloudflare verified-bot category. A legacy AI user-agent label covers 1,852 observations as an overlapping subset and must not be added to the base total. The 49,709 fallback rows are not confirmed human traffic. The existing Cloudflare GraphQL collector uses `httpRequestsAdaptive`, ascending datetime, a 10,000-row query limit per window, and does not request or apply sampling weights. The observation sum is neither a sampling-corrected estimate nor the full request volume. A missing day, query-window cap, or bot label must not be interpreted as zero users or full traffic.

For 2026-08-24 through 2026-09-22, 60,101 stored base observations cover 29/30 days. Public host route counts over the full edge window were `/` 3,639; `/robots.txt` 1,162; `/sitemap.xml` 475; `/llms.txt` 70; `/.well-known/agent-card.json` 50; `/auth.md` 9; and `/mcp` 108. The route sample is incomplete by design (top paths retained); a request does not prove successful parsing, tool execution, indexing, citation, or a new user. Status observations include 21,524 responses coded 404 and 10,478 coded 504, and status was not joined to named agents.

The MCP endpoint moved on July 19 to a `workers.dev` origin. The Cloudflare zone snapshot for `sharehtml.zhenjia.dev` does not necessarily include direct calls to that origin. Do not divide observed main-host `/mcp` requests by `mcp`-tagged creations as a conversion rate.

The release audit joins GitHub Cloudflare Workers Builds checks to exact commit SHAs and Worker version metadata. The June 6 production build completed at 02:59:16 Taipei; June 8, June 16 and June 20 changes also have successful production-build evidence. July 19 deployment records join exact version/SHA pairs at 10:15:43 (private sharing/discovery), 10:33:58 (bot-safe MCP origin), and 12:44:12 (registry-identity code), each at 100% traffic. May 26's original deployment could not be recovered, but those commits are ancestors of the verified June 4 production build. A build completion and a recorded traffic switch remain different evidence levels. The uneven, sampled edge intervals and bundled changes support descriptive before/after analysis, but do not isolate the causal contribution of SEO, GEO or WebMCP.

## Analytics scope

This historical report does not include GA4: there is no dedicated Share HTML GA4 history for this observation window. Blog-property data is excluded. A newly created, separate Share HTML measurement stream is for future observation and cannot backfill this snapshot. Historical product activity comes from frozen application records, timestamped historical application events, limited Cloudflare edge aggregates, and the separately sampled Cloudflare RUM query described below.

## Timestamped use, follow-up and browser acquisition

The underlying `share_events` table retains event timestamps. The initial snapshot export contained only per-share cumulative counts; that export limitation must not be described as missing historical timestamps. Read-only follow-up queries use the original cutoff, excluding all later research requests.

- Events occurring from July 1 Taipei through the cutoff: 14,969 `viewed`, 2,786 `created`, 20 `access_granted`, and 4 `reported`. These are distinct operations, not additive people or a conversion funnel. The 14,969 period requests include 30 requests to pre-July shares; 14,939 belongs to the July–September creation cohort.
- For that creation cohort, 1,100 of the 1,377 shares with a content request had their first request within one minute. This supports immediate-preview or delivery-check hypotheses, without identifying who requested it.
- Fixed 24-hour, seven-day and fourteen-day follow-up denominators include only shares old enough at the cutoff to have completed the window. Days 2–7 means `[creation + 24h, creation + 7d)`; days 8–14 means `[creation + 7d, creation + 14d)`. These measure content activity, not returning people.
- September API labels: 674/817 mature seven-day records had a request within seven days; 116/817 had a request during days 2–7. September MCP labels: 5/201 and 0/201 respectively. Source remains caller supplied; creation age is controlled by the observation window, while purpose and caller characteristics are not randomized.
- The top five records account for 5,842/14,939 requests (39.1%); the top 28 account for 7,385 (49.4%). They remain in the main totals. Excluding head records is a separately labeled sensitivity analysis, not data cleaning.

Actual Cloudflare RUM GraphQL reads, filtered to `sharehtml.zhenjia.dev` and the same Taipei-month/cutoff boundaries, recovered sparse historical browser-source observations. The selected query reports approximately 580 page loads and 550 Cloudflare visits, with average sample interval 10. These are already estimated counts; never multiply them by 10 again or call them unique people. July returned no sampled rows, which does not establish zero traffic or a collection start date. August returned an estimated 10 loads/visits; September returned 570/540.

Across returned periods, homepage/product pages account for an estimated 300 page loads; share wrappers/uploaded content account for 280. The two only observed named external referrers, `l.instagram.com` and `com.google.android.gm`, each contributed approximately 10 visits to share wrappers, not to the product homepage. Another 530 visits had an empty referrer, meaning direct **or unknown**. The RUM bot flag is separate from the legacy edge classification, and a zero flag does not prove a human. These data support content-distribution clues, not a measured referral-to-creation funnel.

The public page uses only the final frozen, category-filtered RUM extraction. Earlier exploratory requests had different cutoff or sampling granularity and are excluded. Raw paths, slugs, tokens, IPs and complete referrer URLs are not published. Server-request observations, RUM browser estimates and application events have different coverage and are not added together.

## Focused content and growth findings

A purposive manual review of the five highest-request public artifacts found five distinct education-related interactive files: knowledge exercises, language practice, a thank-you-card maker and a learning-result lookup interface. All five were missed by the global rule classifier, chiefly because of multilingual vocabulary and instructional expressions. Their manual interpretation is a separate case-study layer; it does not change the 45.7% global rule-match rate or estimate the prevalence of educational users. No original titles, student information, URLs, hashes or private contents are published.

The September API increase is concentrated after September 10 (16 records on September 1–9, 1,410 on September 10–23). API labels contribute 1,404 of the 1,628 net additional records in equal August/September 1–23 windows. Shared UA/IP grouping concentration points to shared technical characteristics; it does not identify people or organizations. The owner's statement that no promotion occurred is recorded as a self-report, not as proof that third parties did not share or integrate the product.

## Reproduction and privacy review

With the frozen snapshot, fetch log, cached public HTML, and Cloudflare aggregate available in `/tmp/sharehtml-0923/`, run:

```sh
python3 scripts/analytics/build_usage_report.py
python3 scripts/analytics/render_usage_report.py
```

The first script asserts the frozen date range and 2,797-row population, reparses cached public HTML without fetching it, and writes aggregate JSON outside the repository by default. Use `--fetch` only when deliberately refreshing public HTML; it sends bounded GET requests and can increase live content-request counters. The renderer embeds only aggregate values and broad paraphrases of manually reviewed public examples. A guard rejects fields such as raw titles, slugs, content hashes, user/share IDs, IP/UA group keys, and full HTML. It removes the raw local directory and named user-agent list before publication. The downloadable JSON is the same privacy-filtered aggregate; the CSV contains only monthly totals.

## Connected chart aggregates (`report_charts`, schema version 1)

The existing aggregate field names remain unchanged; legacy `preview` names are presented as “content requests” in the report. This is a clarification of the same historical `viewed` counter, covering embedded iframe loads and direct HTML opens; it does not refresh the snapshot or separate those unrecorded contexts. `report_charts` adds these chart-ready objects without publishing record identifiers, content hashes, titles or uploaded text:

| Field | Shape and denominator |
| --- | --- |
| `creation_daily` | `{date, records, sources, partial_day, trailing_7_day_mean, trailing_observed_days}` for every Taipei calendar date from July 1 through the cutoff. `sources` has `api`, `mcp`, `direct`, `other`, `unknown`; these are self-reported labels. Recorded zero-count dates remain zero. |
| `creation_weekly` | Monday-based `{week_start, week_end, records, observed_days, complete_days, sources, records_per_observed_day}`. First and final weeks have partial coverage. `observed_days` includes the final partly observed date; `complete_days` excludes it. |
| `source_purpose_preview_flow` | Exactly 2,640 active public share records, preserving duplicate uploads. Source label → inferred purpose → whether that same record has any cumulative content request. Top six purposes are ranked by record count in this cohort, plus other purposes and unclassified. |
| `snapshot_outcome_funnel` | Nested counts from all 2,797 snapshot records, then currently active, then currently active with at least one cumulative content request. A snapshot outcome diagram, not SEO acquisition, people or chronological conversion. |
| `edge_daily` | UTC day, mutually exclusive `base_observations`, stored `classes`, and overlapping `ai_subset_overlapping`. August 25 has null values, not zeros. |
| `milestones` | Separate `code_change`, `deployment_observed`, and `measurement` types. Commit timestamps do not establish deployment or causal effects. Date-only measurement markers carry their own timezone. |

A trailing mean uses the current date plus six preceding observed calendar dates; the first six dates are null, because a full seven-day window is unavailable. The last mean includes the partial cutoff date and must retain that flag in labels. Weekly totals should display observed-day coverage rather than implying complete weeks.

Flow nodes are `{id, stage, label}` and links are `{source, target, value}`. `paths` additionally retains anonymous `{source, category, preview, records}` counts for joint-path tooltips; pairwise Sankey links alone cannot identify which source contributes to a downstream preview branch. Each adjacent stage sums to 2,640; do not add both link layers together as a cohort total. A content request is a cumulative counter entry, not a unique reader or a successful browser session. The outcome funnel's current status does not establish the status at the moment a content request occurred.

The generator asserts daily/weekly/source totals, fixed active-public flow denominator, both link-layer totals, intermediate-node flow conservation, nested outcome counts, snapshot date bounds, the edge gap, and the edge base total. Existing duplicate, privacy and preview-distribution fields retain their original denominators. Rebuilding reads the frozen snapshot and already downloaded public HTML only; no private HTML or extra network fetches are involved.

## Historical request-country aggregates

`edge_country` reads the optional existing D1 exports selected by `--country` and `--country-monthly`. The exports contain only country code, request class, counts and coverage metadata from `daily_country`; no IP addresses or individual request details are read. Default local sources are `/tmp/sharehtml-0923/country-query.json` and `/tmp/sharehtml-0923/country-monthly-query.json`. If the total-country export is absent, `edge_country` is null; absent monthly export yields an empty `monthly` object. Missing inputs are not reported as zero activity.

The field has `{from, to, timezone, base_observations, ai_subset_overlapping, countries, monthly, note}`. Each country row is `{country, base_observations, classes: {human, unverified_bot, verified_bot}, ai_subset_overlapping}`. `monthly[YYYY-MM]` repeats the aggregate totals and country array. Country values must be two uppercase letters. Country/region codes identify the network location of a stored request, not a person's residence, nationality or the location of a creator. Cloud infrastructure, proxy services and bots can dominate these observations. The legacy `human` class means unmatched traffic, not confirmed people.

Coverage is June 3 through September 22 UTC, separate from the July–September creation cohort. June and September are partial calendar months; the August 25 host gap remains a gap. The mutually exclusive basic-class total is 70,340; the 1,852 AI observations overlap those classes. Sampling and collector-cap limitations from the historical edge export apply unchanged. Country shares must use the displayed request-class denominator, never share creations or estimated people. The generator checks each base class and AI subset against the frozen daily edge export, checks each month's totals, and reconciles each country's monthly totals and class counts to the full-period aggregate. No referrer or acquisition history is reconstructed from geography.

The source export contains six observations in the non-country `T1` bucket (five legacy unmatched, one unverified bot). These are included under `ZZ` in the country-only output rather than discarded or displayed as a country. Other values outside the two-uppercase-letter format are likewise normalized to `ZZ`; arbitrary source text is never published as a country label.

`XX` (unknown) is also normalized to `ZZ`. `known_country_code_count` excludes `ZZ`; a raw bucket count must not be labeled a count of known countries or regions. No location is inferred for unknown or Tor-related traffic.
