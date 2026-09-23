# September 23 analytics delivery evidence

## Database

- The production analytics migration was approved explicitly and applied successfully through Supabase on September 23, 2026.
- All three new tables have RLS enabled. Event and ingestion functions are security invoker. Anonymous and authenticated roles cannot execute maintenance.
- A request without the Worker secret was rejected by the write RPC. Anonymous reads were checked separately.
- A transactional recovery probe inserted two internal events 120 days old, ran maintenance twice and verified: raw probe rows expired, exactly two events preserved in daily aggregates. The entire probe was rolled back, then an empty real maintenance run succeeded.
- `share-html-analytics-maintenance` is active at `17 2 * * *` UTC. Automatic scheduled execution remains to be observed after its first scheduled run; manual maintenance success is a separate fact.
- The additive WebMCP migration was independently reviewed and applied as `20260923163924_analytics_webmcp`. Production constraints include the four WebMCP events, transport and private-access tool name; all three tables retain RLS, ingestion remains security invoker and maintenance remains unavailable to anon/authenticated roles.
- The independently reviewed country migration was applied as `20260923170444_analytics_country`. Raw and daily tables were empty before migration. A rolled-back production transaction verified four 120-day-old probe events aggregate into three country groups (US=2, JP=1, ZZ=1), survive repeated maintenance without duplication, and expire from raw storage. All three RLS flags remain enabled and anon/authenticated roles still cannot run maintenance.

## Application

- Full application suite passed after WebMCP instrumentation and upload association were added (22 files, 557 tests). Final release build and production validation are recorded below when completed.
- The final application suite after country attribution and privacy changes passed all 573 tests in 22 files on September 24 (Taipei). JSDOM emitted its existing unsupported `scrollTo` notices; there were no failed tests.
- Client tests check consent refusal/revocation, storage sanitization, safe attribution, private route normalization, shared tab-session linkage and manual Google parameters.
- Worker tests check payload bounds, event allowlists, privacy, atomic-ingest outcomes, classification evidence, internal markers and server creation/preview semantics.
- Browser-tab control timed out, but native Chrome control succeeded using the user-authorized Jocker profile. The existing zhenjia.dev resource was inspected read-only and contains the blog stream; its data is not included in the Share HTML report.
- Following explicit user confirmation of the account and isolation requirement, a separate Share HTML property and Share HTML web stream were created. The dedicated stream settings were reopened and Enhanced measurement was confirmed off. The user explicitly chose this setting and sanitized manual events. The application configuration uses only the new stream ID, with separate cookie domain/prefix. Production collection is checked after deployment.
- The Share HTML resource's Events page confirmed the saved `share_created` key event; it currently has no detected stream activity before deployment. The targeted client suite passed all 10 tests, including active-versus-blocked Google conversion behavior.
- The event-scoped custom dimension `Acquisition source` was saved and verified against `acquisition_source` in the dedicated Share HTML resource.
- The final bilingual report has 18 figures and 24 data tables. Offline DOM verification passed in Chinese and English: all chart hosts rendered, six new research projections were present, fixed-window denominators and country sums reconciled, language switching preserved data, and the English page had no untranslated Chinese apart from the language button.
- The September 24 release build and typecheck passed. The existing large-client-chunk warning remains. Native Chrome previously confirmed the white report and country chart; the final expanded edition and mobile visual check could not run while the Mac was locked. The user was asked to unlock; offline checks do not substitute for visual verification.

## Historical analysis checks

- Using the data-validation guidance, root independently recomputed row uniqueness, all funnel stages, the flow population/source margins, content-request outcomes and daily creation counts from the frozen snapshot.
- The state funnel reconciles to 2,797 created records, 2,778 active records and 1,367 active records with content requests. The flow chart uses the same 2,640 active public records at every stage; 1,357 have content requests.
- The Cloudflare series retains August 25 as missing (`null`) and its observed-day totals sum to 70,340. It is never added to creations or represented as people.
- “Content requests” includes both embedded HTML loads on the share page and direct HTML opens. The historical `viewed` events do not distinguish these contexts.
- Existing D1 country aggregates were read through the authorized Cloudflare OAuth session. The country base sum is 70,340 with the same 49,709/17,612/3,019 class totals and overlapping AI subset of 1,852. The original country export and monthly export remain in the local research directory; no IP or individual location was queried.
- The current Jocker Google login opened Search Console's welcome/verification screen. No Share HTML Search Console historical data was obtained or mixed into the report.
- Follow-up read-only queries recovered timestamped `share_events`, reconciling the original 14,939 cohort requests with 14,969 period requests (30 on older shares). Fixed-window follow-up excludes immature shares; it never treats the original export's missing columns as nonexistent source data.
- Actual Cloudflare GraphQL RUM queries recovered a frozen sampled estimate of 580 page loads / 550 visits and sparse share-page referral clues. Final figures exclude exploratory queries with a different cutoff or sample level. HTTP referrer-field permission was separately denied; RUM read access succeeded.
- Deployment checks were joined to Worker version metadata: July 19 exact SHA/version traffic switches and June production-build evidence supersede the initial unlinked timeline. CI dry-run, Registry publication and Worker deployment are distinguished.

Historical report metrics use the frozen cutoff in the report methodology. Research preview fetches happened after that cutoff and are excluded from that historical baseline.
