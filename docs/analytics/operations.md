# Share HTML usage measurement

The historical report is frozen at 2026-09-23 15:27:28.147672 UTC (23:27 Taipei). Prospective telemetry cannot reconstruct missing historical acquisition or identify people from IP groups.

## Why first-party measurement is the primary store

GA4 remains useful for consenting browser acquisition and conversion reporting. It automatically excludes known bot traffic and does not report how much was excluded. It therefore cannot serve as the primary agent-use ledger. The first-party Worker records actual MCP/HTTP outcomes and minimized request evidence in Supabase; its business records remain authoritative if background telemetry fails.

Official references checked September 23, 2026:

- [GA known bot exclusion](https://support.google.com/analytics/answer/9888366)
- [Measurement Protocol supplements automatic collection](https://developers.google.com/analytics/devguides/collection/protocol/ga4)
- [Google AI features and Search Console measurement](https://developers.google.com/search/docs/appearance/ai-features#measuring-the-performance-of-your-site)
- [OpenAI crawler roles](https://developers.openai.com/api/docs/bots)
- [Cloudflare verified bots](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/)
- [GA4 cookie domain and prefix configuration](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)

## Activation order

1. Apply `supabase/migrations/20260923154418_analytics_measurement.sql` after production approval. This creates only analytics tables/functions and the maintenance job. Check that the migration completed atomically.
   Follow with `20260923155702_analytics_page_served.sql`, `20260923163924_analytics_webmcp.sql`, and `20260923170444_analytics_country.sql` before enabling the corresponding application events. These additive migrations are already applied to the production project for this release.
2. Verify RLS, unauthenticated rejection and the active daily cron job. Run maintenance once and verify aggregation before relying on the schedule.
3. Deploy the Worker with `ANALYTICS_ENABLED=true`. The browser receives this setting through the existing config injection. Without it, telemetry is disabled.
4. Use `ShareHTML-Validation` as the verification User-Agent and `internal_validation` as the legacy/acquisition source. Verify persisted events, not only HTTP responses. Internal markers are explicit self-reports and do not identify all owner traffic.
5. Query production metrics with `traffic_type='production'`. Do not add overlapping browser and server success/failure events together.

## Optional browser measurement

The preference notice is non-blocking. Optional browser/session analytics starts only after an affirmative choice, respects Do Not Track / Global Privacy Control, and can be turned off again from Analytics preferences. A sessionStorage UUID connects events within a tab; it is not a person or durable cross-device identity. No filenames, document titles, uploaded HTML, share IDs/slugs, fragments, access keys or arbitrary query strings enter the analytics payload. Routes are templates. Only bounded UTM tokens and an external referrer hostname are retained. Denial removes the optional tab context; coarse service events remain independent.

The production configuration targets the dedicated **Share HTML** GA4 property (555549679), separate from the **zhenjia.dev** blog property. Its only web stream is **Share HTML web**, `https://sharehtml.zhenjia.dev`, measurement ID `G-8B4LL2C8L7`. On September 24 (Taipei), the stream settings were reopened and Enhanced measurement was confirmed **off**, with zero connected site tags. The resource's Events page also confirmed `share_created` as a key event. Cookie names use the `sharehtml` prefix and are scoped to the current product hostname rather than the shared parent domain. The consent notice names Google Analytics. See the validation record for actual deployment and collection evidence.

To configure a replacement stream safely:

1. Use a dedicated Share HTML property and web stream in the user's GA account (Editor access needed for stream settings). Do not reuse the blog property, tag, or cookie namespace.
2. Disable **Enhanced measurement**, including automatic form, download, click and history events. This app handles private links and must not let automatic collection inspect raw URLs or form interactions.
3. Set public Worker variable `GA4_MEASUREMENT_ID` to that stream's `G-...` ID and `GA4_AUTOMATIC_EVENTS_DISABLED=true` only after verifying the setting. No GA API secret is needed.
4. Check GA DebugView/realtime with consent granted. Only manually sanitized events are sent: `page_view`, `upload_started`, `upload_failed`, `share_link_copied`, `share_created`. Confirm `share_created` as a key event if desired. Add event-scoped custom dimensions for `transport`, `actor_evidence`, `referrer_domain` and `acquisition_*` as useful.
5. Verify denial makes no browser telemetry/Google requests and private `/s/` pages never initialize GA. Uploaded `/v/` HTML is never modified to inject analytics.

Without an ID and verified auto-collection setting, the server does not expose an ID and the browser never loads Google's script. GA configuration is optional for the primary telemetry to function. No historic data is backfilled to GA.

## Interpretation

- `page_served` covers successful GET HTML responses for homepage, marketing pages and share wrappers, including crawler requests without browser consent. It excludes HEAD and errors, is separate from `discovery_read` and `preview_served`, and does not prove a human or protected-preview access. Apply the additive `page_served` event-name constraint migration before deploying this coverage.
- The internal `preview_served` event and historical `viewed` counter both describe successful HTML content requests, including iframe loads and direct document opens. Use “content requests” in product reports. Historical counters do not distinguish the two contexts; a share-wrapper response alone is a separate `page_served` event.
- Browser `page_view` and server `page_served` can describe the same navigation; never sum them. Server response counts provide a request-activity denominator; consented session events provide a different browser-funnel denominator. Neither counts unique people, and no-consent/cache/client-navigation differences prevent one-to-one reconciliation.

- Compare canonical persisted share creations with `share_created` event coverage; timeouts can lose background telemetry. The Google browser key event is emitted only for an `active` upload result. First-party server `share_created` records retain both success and blocked outcomes; filter `outcome='success'` when counting completed creations.
- `transport='mcp'` is established by the MCP handler. A client-controlled source label cannot change it. HTTP uploads include browser and automation clients.
- UA classification is explicitly self-reported. A browser-like UA or JavaScript event does not establish a human. Cloudflare's verified flag is separate evidence.
- MCP initialize client family is a self-report. Stateless subsequent tool calls are not silently joined to it using IP or global memory.
- Search crawl, training crawl, user-requested AI fetch, AI referrals and actual tool usage are different activities.
- `country_code` is the coarse country/region of the request's network exit, taken only from Cloudflare's `request.cf.country`. Unknown or invalid values are `ZZ`; no city, coordinates, or raw IP enters event storage. Proxy, VPN and hosted-agent exits do not establish a person's residence or nationality. Historical events are not geolocated retroactively.
- Count tab sessions within a defined slice; do not sum daily/session counts as unique people.
- Daily UTC rollups retain route/status, actor evidence, source and MCP dimensions. Raw data retention is 90 days; daily aggregates 730 days. Full semantic content classification remains an explicit offline research activity, not an automatic claim about each new upload.

See [measurement-contract.md](./measurement-contract.md) for schema, event definitions, rate limits and operator SQL. A report should always state coverage, cutoff, gaps and whether GA/Search Console data was available.
