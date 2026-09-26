# Map/list parity behavior contract, version 1

This is the reviewable behavior contract and fixture foundation for [#196](https://github.com/wirhabenzeit/activitymap/issues/196). It distinguishes the desired cross-platform behavior from the existing implementation. Merging this document establishes the implementation reference; it does not establish that every capability is implemented or visually verified.

Baseline: `5a9e213` (2026-09-26), including merged #190 (web elevation), #194 (inline list details and responsive widths), #189 and #231 (native sync/freshness). Implementation ownership remains in [#195](https://github.com/wirhabenzeit/activitymap/issues/195). This document does not close #196: comparable screenshots, physical-device/accessibility review and measured performance baselines remain to be collected.

The portable examples live in [`shared/parity/`](../shared/parity/README.md). They use synthetic data and canonical string IDs. They are projection fixtures, not substitutes for complete v1 DTO validation. TypeScript and Swift implementations should run these same examples through their real predicates/transitions/reducers, rather than each implementing a second reference algorithm in the test suite.

## Selected, active and inspected activities

These are three distinct concepts:

- **Selected IDs** are a set of existing owned activities. Selection can survive filtering and can include activities without map geometry.
- **Active map activity** is one selected, currently filter-visible activity, or none. Its route has the strongest emphasis when geometry exists. A selected GPS-less activity can still have active map detail without inventing a route.
- **Inspected list activity** is one independently opened detail, or none. Inspecting or dismissing it never changes selection or the active map activity.

Visibility means passing the shared activity filter, not being inside the current camera bounds. The results panel shows **visible selected activities**; its count says `N selected · H hidden by filters` when necessary. Map layers and picking use the same visibility predicate. Hidden selected routes are neither drawn nor picked; their IDs remain selected until explicitly cleared, removed or deleted. This preserves deliberate multi-selection without misleading counts.

| Event | Selection | Active map activity | List inspection |
| --- | --- | --- | --- |
| Select one / replace selection | Replace with supplied existing IDs | If exactly one supplied ID is visible, activate it; otherwise retain the existing active ID only if still selected and visible | Unchanged |
| Toggle/add/remove | Apply to the set; IDs stay unique | Reconcile as above; never retain a removed/hidden active ID | Unchanged |
| Activate a result | Unchanged | Set if selected and visible; an invalid activation clears active without selecting anything | Unchanged |
| Open/close list detail | Unchanged | Unchanged | Open/clear inspected ID |
| Filter changes | Preserve existing selected IDs | Preserve only if still visible; otherwise clear. Merely restoring a filter does not reopen a formerly active detail | Close if the inspected row is no longer visible |
| Select all in named scope | Union the indicated IDs with existing selection | Reconcile selection as above | Unchanged |
| Deselect all in named scope | Subtract only the indicated IDs | Reconcile selection as above | Unchanged |
| Clear selection | Empty | None | Unchanged |
| Committed deletion/rebootstrap removal | Remove absent IDs | Reconcile remaining selection | Close if absent |
| Logout/account/deployment transition | Empty | None | None |

Web pagination's header checkbox is explicitly **Select this page**; offer **Select all filtered activities** separately. Native continuous-list selection uses **All filtered activities**, not only instantiated SwiftUI rows. Both expose deselect-all and mixed selection feedback. A global Clear selection includes hidden IDs.

An ordinary map tap selects the deduplicated hit set, preserving web's ability to pick overlapping routes. Order overlap choices by nearest screen-space route, then descending canonical numeric ID for a tie. One hit opens detail; multiple hits present a chooser/results panel rather than arbitrarily hiding all but one. An explicit add mode supports union with existing selection. Empty-map selection taps clear map selection; panning/zooming is not a selection tap. Activity route hits have priority over external feature overlays; photo controls consume their own tap before route picking.

Area selection is an explicit mode on touch devices: choose a screen rectangle, preview its eligible intersecting route IDs, then confirm replacement or addition. Cancel preserves prior selection. Provide a **Select routes in visible map** action plus result review as an accessible alternative to a precision drag. Do not silently reinterpret the region as “route start inside rectangle.” Web Shift-drag and native confirmed rectangle use the same intersection outcome, with platform-appropriate touch tolerance.

## Show on map and retained context

Show on map adds the target to selection, makes it active, navigates to the map and frames its best current geometry. It retains other selected IDs. Camera fitting includes safe areas and the result panel's occupied area and handles degenerate/antimeridian bounds without a world-spanning jump.

The action is unavailable with an explanation for GPS-less activities; inspection, other actions and photo galleries remain available. If invoked from a surface holding a now-filter-hidden target, expose **Clear filters and show on map** as an explicit action instead of silently changing filters or showing an invisible active route.

Retain center, zoom, bearing, pitch, style, overlays and photo-layer state across tabs. Retain list sort, density, visible metrics and scroll anchor. Pitch changes preserve location/zoom. **Fit selection**, **Fit filtered routes**, **Reset bearing** and **Reset map view** are separate commands. Repeated renders or sheet drags do not continuously refit the camera. Account/deployment transitions clear account-specific selection/detail and transient media state; map display preferences can remain device preferences.

Owners: #198 reconciles web selection; #204–#207 implement native state/navigation/picking; #209 supplies the native results panel.

## Filters and defaults

All restrictions combine with AND. There is one filter state for list, map routes, result counts, photo eligibility and filtered summaries. Reset means all known sports, no date/numeric restriction, empty search, and **Any** for each binary field.

| Filter | Contract |
| --- | --- |
| Name search | Normalize name/query to Unicode NFC, use locale-independent lowercase, trim the query's outer whitespace, then perform substring matching. Internal whitespace and accents remain significant. Empty/whitespace-only search imposes no restriction. |
| Sport types | A set of canonical sport types; no selected sports means no results. A missing fixture field means all, not an empty set. |
| Sport groups | Group controls modify only their member types and derive all/none/mixed from those types. There is no second hidden category predicate that can contradict checked types. Existing category memberships/colors are the reference. |
| Commute/private/flagged | Each has Any/Yes/No. Any includes true, false and unknown/null; Yes matches only true; No matches only false. Unknown is not false. All three restrictions must be visible and resettable. |
| Numeric values | Inclusive `>=` or `<=` on distance, elapsed duration and elevation gain. An active comparison excludes absent/non-finite values. A measured zero participates normally. UI input converts exactly once to canonical metres/seconds. No restriction means missing values are included. |
| Dates | Inclusive activity-local calendar-day range, represented semantically as `YYYY-MM-DD` endpoints. No restriction means all dates. Reject invalid/inverted UI ranges with actionable feedback rather than silently applying a different range. |

The current `start_date_local` wire timestamp is a local wall-clock value transported with a UTC-shaped suffix. Its date components describe where/when the activity took place; **do not apply the device timezone or the activity timezone to it again**. For the existing JavaScript Date representation, extracting the ISO/UTC calendar components recovers that encoded local day. UI picker Date objects instead describe the user's chosen calendar components; convert their local Y/M/D to date keys before comparison. Prefer persisting day keys for new state; explicitly migrate legacy persisted instant bounds without losing the user's chosen day in the originating timezone when it is recoverable. Legacy records without timezone context cannot reconstruct a traveled device's historical timezone exactly; document and test the deterministic fallback rather than claiming otherwise.

Presets resolve day keys when selected, not once at module load. This year/month spans the full calendar period; last year/month spans the preceding full period. Last 12 months means the corresponding local calendar date one year earlier through today, with a leap-day clamp. Native and web may expose different quick presets, but custom ranges and common presets must produce the same day bounds for the same supplied calendar context.

Existing category colors: BC/XC ski `#1982C4`, trail/hike `#FF595E`, run `#FFCA3A`, ride `#8AC926`, miscellaneous `#6A4C93`. Labels, group membership and canonical sport identifiers remain the current `src/settings/category.tsx` / `SportType.swift` baseline. Icons stay native. Selection/active feedback must also have shape/weight/text cues, since color alone is insufficient.

Owners: #197 and #210. The shared fixture's expected filter IDs preserve input order; sorting is a distinct operation.

## Sort, metrics and summary scope

The default remains **canonical numeric activity ID descending**, matching merged web behavior; do not silently substitute timestamp order. A single primary sort is the baseline (current header actions do not expose ordered multi-sort). Sorting returns every filtered result exactly once and is deterministic across pages/scrolling.

For each supported primary key, null/unknown values sort last in **both** directions. Ties break by canonical numeric ID descending. IDs must not be compared lexicographically or cast beyond a platform's safe integer range. Numeric fields use unrounded canonical values. Date/time use the encoded activity-local wall-clock components. Name/description use NFC plus locale-independent lowercase with Unicode scalar lexicographic ordering; accent removal and device-locale collation must not change fixture order. Sport types use canonical identifiers. Photo count uses available metadata count, not decoded images. Geometry status uses an explicit ordered key documented by #199, not localized label collation.

Supported fields include the existing web sort/display controls: ID, name/description, local date/time, sport type, distance, moving/elapsed time, speed, elevation gain/extrema, HR/power fields, kudos count, photo count and geometry status where present. If a column has no meaningful sort (for example a composite action control), disable its sort affordance explicitly. “No sort” returns to the documented default. Native exposes the same meaningful sort keys through a compact menu; it need not copy a desktop table header.

| Metric | Meaning / aggregation | Display meaning |
| --- | --- | --- |
| Distance | Sum of known metres | Kilometres to one decimal |
| Moving/elapsed duration | Separate sums of known seconds | Hours/minutes, then days/hours for long durations; never conflate moving with elapsed |
| Elevation gain | Sum of known metres | Whole metres |
| Elevation high/low | Maximum/minimum of known values | Whole metres; independently available |
| Average speed | Arithmetic mean of known activity averages (including zero), not total distance/time | km/h to one decimal |
| Average/weighted-average watts and average HR | Arithmetic mean of known activity values; “weighted” is the source activity metric, not an aggregate weighting instruction | Whole watts/bpm |
| Max watts/max HR | Maximum of known values | Whole watts/bpm |
| Date count | Distinct activity-local calendar days in scope | Day count, independent of viewer timezone |

Do not coerce null to zero in rows, detail, filtering or totals. Show each available metric independently; missing a max does not hide an average, and missing elevation extrema does not hide gain. An empty scope has count zero and additive totals zero; means/extrema are absent. A nonempty all-unknown scope has an **unknown** total, not a measured zero. For partial aggregates track the known-value count and make missing coverage discoverable. Round only for display, using the same semantic precision; locale-specific separators/spacing/date presentation may remain native. Numeric fixtures compare unrounded results within `1e-9`.

Summary mode defaults off. **Filtered activities** means the complete filtered set before pagination, **Selected activities** means the complete selected set including hidden selections, and **This page** means the current web page's data rows, excluding expansion/measurement rows. Counts and labels disclose the scope. A native continuous list offers filtered and selected summaries and the count of all reachable results; the absence of a pagination page is a declared platform adaptation, not a hidden switch to summing instantiated cells. If a native paged layout is used, offer This page as well.

Owners: #199, #203, #211 and #212. The native default hierarchy is name/sport/local date followed by distance, elapsed duration and elevation; configurable additional metrics stay accessible in detail even when hidden from a compact row.

## Adaptive presentation and desktop equivalents

| Web outcome | Native adaptation / expected behavior | Owner |
| --- | --- | --- |
| One selected route detail | Direct detail in map results; keep map interaction available | #208/#209 |
| Multiple selected routes | Compact count/result panel with explicit expansion; clear selection and active feedback remain reachable | #209 |
| Inline independent list detail (#194) | A single inline expansion on larger layouts; compact native presentation may use a detented detail if it preserves independent inspection, scroll return and separate action taps | #208/#211 |
| Responsive table/hidden columns | Configurable row metrics/density, full information in detail, adaptive wider iPad layout | #211 |
| Column pinning/horizontal width modes | Keep identifying name/context visible while browsing metrics; do not require a 900px table on a phone | #211 |
| Pagination | Lazy continuous traversal is acceptable if all filtered results are reachable and summary scope remains explicit | #211/#212 |
| Hover photo/route hints | Explicit tap and accessible actions, including fullscreen gallery | #218/#219 |
| Desktop fullscreen | Map-focused native presentation with collapsible chrome and recoverable controls | #209/#223 |
| Rectangle selection | Explicit confirmed area mode plus accessible visible-region alternative | #207 |

These are proposed capability-preserving adaptations for review, not claims of reviewed visual acceptance. Any capability removed rather than adapted needs an explicit exception linked from #195.

Reference surfaces must be captured from the same fixtures: no activities, no filter results, activities without GPS, dense overlapping routes, one/multiple/hidden selections, long names/descriptions, partial/zero metrics, summary loading/pending/error/unavailable, photos with/without locations, and old offline data. Include small iPhone, landscape and iPad; light/dark; default/large Dynamic Type; VoiceOver. Use at least 44pt native touch targets. Keep actions reachable with long content and preserve map gestures while the results panel is open. Matching colors, metric order and hierarchy matter; platform typography and presentation primitives need not be pixel-identical.

## Streams, photos and freshness

Compact elevation charts use server summaries; full raw samples are independent. Require aligned altitude and usable forward distance for the current elevation-by-distance baseline. A time-basis or absent series is an explicit unavailable profile, not a zero chart. Do not index samples into an independently simplified route polyline. HR/power charts and map-linked scrubbing remain outside this parity baseline.

Respect server retry timing for pending/429/retryable 503 and bound/cancel requests. No raw download or decode on ordinary map/list launch, compact detail open or sync. #230 may change the encoded summary format and delivery after measurement; it has not yet selected a codec or shipped activity-embedded samples.

Photo metadata is already synced. Galleries preserve activity association and distinguish cached bytes from merely known URLs. Valid zero latitude/longitude are valid map locations; null/out-of-range coordinates omit only the map marker. Image failure is neither an empty library nor an expired session.

#231 resolves freshness ownership: there is no seven-day client data TTL. An unexpired scoped session may read a 30-day-old cache, including when server reconciliation metadata is missing. An old timestamp is informational; known server generation/revision/state invalidation is authoritative. True session expiry, 401, logout, account/deployment transition and observed disconnection/deauthorization still clear/fence data. Reconnect applies changes/tombstones, or one bounded `409 sync_rebootstrap_required` recovery; authoritative snapshot replacement also removes orphan photo/stream caches. Image/cache capacity eviction is a separate policy from source freshness.

Owners: #200, #213–#219, #227 and #230. Stream contracts remain in #185; this document is not an alternate transport schema.

## Capability ownership and release evidence

| Capability / preparation | Implementation issues | Evidence gate |
| --- | --- | --- |
| Shared decisions, fixture corpus, matching references | #196 | Fixture consumers plus screenshot/device checklist below |
| Web filter/state/metric/stream reconciliation | #197–#200 | Shared vectors and focused regression tests |
| Authenticated v1 edit/refresh | #201/#202 | Owned/non-owned boundaries, truthful upstream/local outcomes, sync/lifecycle tests |
| Native faithful models, state, camera, picking, area selection | #203–#207 | Transition and geometry fixtures |
| Reusable detail/results/filter/list/summary/offline UI | #208–#213 | Composed flows and adaptive/device review |
| Native transport, summary cache, raw cache | #214–#216 under #185 | Disk reopen, generation/race/rebootstrap tests |
| Elevation and photo gallery/map layer | #217–#219 | Series/coordinate/offline and accessibility fixtures |
| Native edit, refresh, GPX/Strava actions | #220–#222 | Real actions with progress/error; no simulated success |
| Location/terrain, GPX import, image export, catalogue/Friflyt | #223–#226 | Style/feature/file fixtures and physical-device checks |
| Composed regression, adaptive/accessibility, performance | #227–#229 | Linked release evidence, not source inspection alone |
| Default backfill and compact-summary investigation | #230 | Observed production rollout; measured format decision |

The following evidence is still outstanding for #196 and must not be marked complete by a documentation-only PR:

- [ ] Capture paired web/native screens for the reference states above; identify baseline revision and fixture IDs.
- [ ] Review native adaptations, any true exceptions, action layout and accessibility on a physical device and iPad/small-phone layouts.
- [ ] Record a named device/OS, browser, dataset activity/geometry/photo/sample counts and measured performance baseline. Establish accepted budgets in #229 before claiming a performance pass.
- [ ] Have each implementation run the shared vectors through actual production behavior. The current corpus is an executable handoff, not proof that existing web/native code already conforms.

Initial performance targets for review are p95 input-to-feedback under 100ms for selection/filter controls, cached detail/profile visible within 250ms, and no raw decode on the main actor. Profile both 2,000- and 10,000-activity libraries and report route vertex/photo/raw sample counts and peak memory/disk growth. These are proposed targets, not measurements or accepted hardware-specific memory budgets; adjust only with recorded evidence in #229.

No authentication/sync rebuild, new training analytics, statistics/dashboard port, offline basemap download or resurrection of disabled sharing is included.
