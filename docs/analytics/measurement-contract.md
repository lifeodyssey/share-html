# Share HTML measurement contract

Version 1, prospective only. `ANALYTICS_ENABLED=true` activates first-party telemetry; absent/other values disable it. The migration must precede activation. Existing shares and `share_events` remain the canonical business/audit records. Background analytics can be lost on timeout or runtime termination and cannot replace them. Nothing backfills historical identity from request addresses.

## Browser contract

When service analytics is enabled, an unset browser preference defaults to enabled. Users can turn it off in Analytics preferences; stored opt-outs are preserved. DNT/GPC override the default, and unreadable preference storage prevents collection. Turning analytics off clears the tab session/acquisition context. This policy also gates browser GA, whose dedicated resource and private-share-page exclusions remain separate requirements.

The September 26, 2026 client change expands collection coverage from affirmative opt-in to default-on with opt-out. The confirmed production timestamp is recorded in Cloudflare deployment history and the release pull request. Comparisons of browser, WebMCP or GA counts across the confirmed deployment boundary must account for this coverage change and must not label the difference as product growth. Frozen historical reports are unchanged.

Same-origin `POST /api/analytics/events`, `Content-Type: application/json`, matching `Origin` required. Maximum streamed body is 4096 bytes. Body:

```json
{"event":"page_view","event_id":"aab11f0d-0baa-417b-8271-620fa97ef198","session_id":"bab11f0d-0baa-417b-8271-620fa97ef198","route":"/","acquisition":{"source":"google","medium":"organic","campaign":"launch","referrer_domain":"google.com"}}
```

Ordinary browser events allowlisted: `page_view`, `upload_started`, `upload_failed`, `share_link_copied`. The same bounded, rate-limited endpoint separately allows preference-eligible `webmcp_available`, `webmcp_registered`, `webmcp_call`, `webmcp_result` with the strict combinations below. UUID `event_id` is globally idempotent; UUID `session_id` denotes a sessionStorage tab session, never a person. All are client self-reports. Uploads may include JSON form field `analytics` with `{session_id, acquisition}`; invalid analytics never blocks upload. `source`, `medium`, `campaign` accept lowercase `[a-z0-9_-]` tokens, maximum 64 characters; referrer is a domain only. Everything else is dropped. Routes are allowlisted; `/s/<slug>` and `/v/<slug>/...` become `/s/:slug`, `/v/:slug`; unknown routes become `other`. No title, HTML, filename, raw IP/UA, key, claim/auth token, slug, full referrer URL, or arbitrary query parameter is stored in the new telemetry.

The browser endpoint returns 204 on accepted or disabled telemetry; 400 invalid body; 403 origin; 413 oversized; 415 content type; 429 rate limit; 503 unavailable storage. The atomic PostgreSQL RPC limits 30 events per tab-session per minute and 120 per daily HMAC IP abuse bucket per minute across Worker isolates. Retries consume rate allowance, but duplicate event IDs never create additional event rows. Abuse buckets are separate from analytics, expire after one day via maintenance, and are never a people metric. Non-browser clients can forge Origin/session IDs; rate limits mitigate pollution, not establish identity.

## Independent dimensions and evidence

- Actor: `ai_search`, `ai_training`, `ai_user_fetch`, `automation`, `browser_unknown`, `unknown` from transient UA matching only, marked `ua_self_reported` or `unknown`. `bot_verified=true` is emitted only from Cloudflare's request `cf.botManagement.verifiedBot`, not a request header. Known AI UA categories remain visible with UA evidence alongside this independent verification; otherwise a verified bot uses category `verified_bot`. `human_likely` is reserved and currently never emitted; browser appearance does not prove a human. UA families may be incomplete/spoofed.
- Transport: `webmcp` means a browser self-report from the instrumented tool wrapper, not authenticated transport or agent identity. `mcp` only from the actual MCP handler; `http_api` for HTTP uploads, discovery and previews; `browser` for browser event ingestion. Browser-originated uploads still use HTTP API transport and can correlate through the untrusted tab session.
- Acquisition: `tagged`, `ai_referral`, `google`, `direct_or_unknown`. Tagged attribution has precedence. Missing referrer does not prove direct arrival. Header referrals are marked `referer_self_reported`, browser/upload acquisition `client_self_reported`. A source value never changes transport or actor.
- Legacy `metadata.source` remains a self-reported tag and is copied separately as `legacy_source`; `source=mcp` on an HTTP upload does not make it an MCP upload.

MCP initialize stores only an allowlisted client family (`claude`, `codex`, `cursor`, `chatgpt`, `other`, `unknown`) inferred from clientInfo.name, self-reported and spoofable. Raw name/version are discarded. Stateless MCP tool calls have `mcp_client=unknown`: initialize cannot be associated with later calls without a separately authenticated or signed mechanism. There is no IP association or global session map. Method/tool are allowlisted; arguments and response content are never telemetry.

`traffic_type=internal` is emitted only for explicit, self-reported `ShareHTML-Research` / `ShareHTML-Validation` UA markers or reserved source tokens `internal_validation` / `internal_research`; otherwise `production`. These markers are spoofable. Production does not prove external traffic, and ordinary owner uploads are not automatically excluded. Daily rollups retain this dimension plus normalized route and HTTP status (0 means unknown/not applicable).

## Event meaning

`page_served` counts successful server GET responses for the HTML homepage, marketing pages and `/s/:slug` wrappers. It is independent of browser analytics preferences, so a crawler that only reads ordinary HTML is included with the same actor/evidence caveats. HEAD, error responses, uploaded `/v` content, report pages and discovery documents are excluded from this event. A private wrapper is only a generic shell: serving it does not prove access to protected HTML. It is a response-count denominator, not a person, rendered page, browser session or conversion. `page_view` is an eligible browser's self-reported view; one navigation can emit both, while cached/client-only navigation and opt-outs or privacy/storage restrictions can make coverage differ. Never add these two event counts together. Use server `page_served` with server outcomes for coarse request activity and eligible tab-session events for the separate browser funnel. The `page_served` CHECK-constraint migration must be applied before deploying this event.

`share_created` means the server completed share metadata, object storage, asset metadata, and scan-state updates. It includes automatically blocked uploads (HTTP 202), which are not successful public delivery. HTTP status and outcome retain that distinction. `share_create_failed` includes validation/rate-limit/server failures. MCP tool result `isError` determines tool failure; HTTP status alone cannot determine MCP success. `preview_served` means GET passed access checks and obtained an HTML object, not that a person rendered or read it. HEAD is excluded. `discovery_read` means a successful GET of a discovery document; it is not a user, lead, install, or conversion. MCP initialize is not an upload. Browser upload_failed can overlap a server failure and must not be summed as unique failures.

## Storage, permissions, retention

`analytics_events` holds raw minimized events, `analytics_daily` daily UTC rollups, `analytics_rate_buckets` temporary abuse state. RLS and explicit grants permit only the existing worker-secret-authenticated anon role to insert/read raw events; true public anon reads yield no rows and RPCs reject absent/invalid worker secret. Authenticated users have no grants. There is no public report/query/admin analytics endpoint. Database operators can query as postgres. Worker RPC functions are security invoker; maintenance is owner-only with EXECUTE revoked from PUBLIC/anon/authenticated.

The additive migration enables the available Supabase pg_cron extension and schedules `share-html-analytics-maintenance` at 02:17 UTC daily. Maintenance recalculates all complete UTC days present in raw storage idempotently before purging, including overdue data after a scheduler outage, retains daily aggregates for 730 days with acquisition and MCP dimensions, deletes raw events older than 90 days and abuse buckets older than 24 hours. Tab session counts are distinct within each daily dimension group, not additive people or globally deduplicated users. Lost raw events cannot be recovered; a failed cron run should be investigated using the checks below.

Operator checks after deployment:

```sql
select jobname, schedule, active from cron.job where jobname='share-html-analytics-maintenance';
select status, start_time, end_time, return_message from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='share-html-analytics-maintenance')
order by start_time desc limit 10;
select event_name, transport, actor_category, count(*) from public.analytics_events group by 1,2,3;
```

No GA Measurement Protocol requests originate from the server. If enabled separately, browser GA4 remains a separate, preference/privacy-dependent data source and is never injected into uploaded `/v` HTML. Historical traffic without this instrumentation remains unknown.

## Browser WebMCP observations

The WebMCP migration expands the existing event/transport/tool constraints and the same ingestion RPC's fixed combinations. It adds no tables, privileges, public reads, new retention policy or alternate rate limits. Apply it before the client release. Existing HTML tool definitions are extracted into `src/client/webmcp.ts` and wrapped without changing their inputs, HTTP requests, returned content or thrown errors.

All four events require enabled first-party analytics, an enabled browser preference, readable preference storage, and no DNT/GPC. An unset preference defaults to enabled; a stored opt-out remains disabled. Tools work even when telemetry is off. Availability and registration state can be reported once per eligible tab context when analytics is enabled; prior tool calls are never replayed. Each invocation rechecks eligibility, so turning analytics off before a result suppresses that result.

| Event | Meaning | Required outcome/tool |
| --- | --- | --- |
| `webmcp_available` | Observed `navigator.modelContext.provideContext` capability | `success` available / `failure` absent; no tool |
| `webmcp_registered` | Our `provideContext` call completed or rejected | `success` / `failure`; no tool |
| `webmcp_call` | Our execute wrapper started, before local input validation | null outcome; allowlisted tool |
| `webmcp_result` | Tool returned or threw, including local validation and network failures | `success` / `failure`; allowlisted tool |

Transport is `webmcp`, legacy_source is fixed `webmcp`, and tool is one of `describe_share_html`, `get_public_share`, `access_private_share`, `create_share`. MCP method/client are null. No arguments, response text, HTML, title, slug, key, raw exception, claimed agent name or other dynamic tool metadata is sent. These events never use the GA sender. Actor evidence remains the request's coarse UA/Cloudflare evidence, independent of the client-reported transport.

Anyone can imitate these client reports; availability is not active usage, registration is not a tool call, and tool invocation is not proof of an AI agent or human. `webmcp_result=success` preserves the tool's existing `isError` semantics, so a server 202 automatically blocked creation can still be a successful tool response. Use the independent server `share_created` status/outcome to distinguish accepted-but-blocked storage from publicly usable creation. When browser analytics is eligible, WebMCP creation attaches the same sanitized tab session/acquisition context as ordinary browser uploads, permitting tab-level association with server outcomes; opt-out/DNT/GPC or unavailable preference storage omits it. Server HTTP creations remain `transport=http_api, legacy_source=webmcp`; do not sum them with WebMCP result counts. Source is now parsed immediately after form decoding so missing-file/extension validation failures retain the label; errors before form decoding cannot be reliably attributed.

All optional events are best effort, with no retries or guaranteed delivery. Rate limiting, unloads, denial, unavailable storage, or a lost request/result can produce unmatched counts. There is no durable per-call correlation ID: concurrent calls and server creations cannot be joined exactly from session/tool/time alone. Report aggregate calls/results with these gaps, never infer historical non-use from zero WebMCP tags.

## Coarse request country

`country_code` is read only from Cloudflare's trusted `request.cf.country` runtime metadata. The Worker accepts uppercase ISO 3166-1 alpha-2 codes plus Cloudflare's `XK` Kosovo code; missing, malformed, unsupported or non-country values become `ZZ` (unknown). Browser-supplied fields and headers such as `cf-ipcountry` are ignored. No city, coordinates, postal code, IP, or inferred demographic profile is copied into analytics.

Raw events and daily aggregates retain this country dimension, with the existing 90-day/730-day retention and permission model. Pre-instrumentation rows receive `ZZ`; historical countries are never reconstructed from stored hashes or guesses. Rollups group country separately and continue aggregating all complete raw dates before deleting expired raw rows.

This describes the network request's apparent country or region, not citizenship, residence, language, ethnicity, age or a person. VPNs, corporate proxies, datacenters and AI/cloud fetchers can identify an exit location rather than the end user's location. Report country/region distributions of observed requests, separated by actor/transport and explicit internal traffic where appropriate; do not label them user population demographics or count requests as people. Optional browser/WebMCP events still follow the browser preference, storage and DNT/GPC eligibility checks; coarse server events keep their existing service-measurement policy.
