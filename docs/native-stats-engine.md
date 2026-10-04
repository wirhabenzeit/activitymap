# Native Stats calculation handoff

Issue #262 implements calculations and history data from the [accepted Stats contract](stats-parity-contract.md). The dashboard and shell integration are implemented in the #263/#254 working revision; the accepted #264 detail interactions and #265 cross-platform reconciliation are included. Named-device accessibility and release performance remain separate acceptance work. See [dashboard review and handoff](ios-stats-dashboard-review.md).

`ActivityStore.stats` owns `StatsController`. The store's `statsActivities` uses the exact browsing predicates with only its date test omitted. Stats reset calls `resetStatsActivityFilters()`: sport/search/numeric/binary restrictions reset, while saved map/list dates, selected IDs, camera and list presentation remain. Duration predicates still use elapsed seconds; all Stats time outputs use moving hours.

Consumers first inspect `StatsPresentation(store:sync:)`. It distinguishes unavailable authorization, loading history, complete no-history/no-matches, ready, incomplete, cached and error-with-content. `historyComplete` is independent of available totals. Loading without history must not display zero totals as measured inactivity. Nonempty ongoing sync keeps data with an incomplete comparison disclosure; old authorized caches retain content without a local TTL. Retry availability comes from the existing sync permission/backoff.

Request typed results outside view-body/row/chart-size evaluation:

```swift
store.stats.refreshToday()
let result = await store.stats.result(.yearComparison(.distance, offset: 0), for: store)
if case .comparison(let comparison) = result {
    // Use comparison.current / previous in km. percentageChange is nil at zero baseline.
}
```

`StatsQuery` covers every specified compact calculation, records/best windows, calendar days/months, full and partial weeks, sport shares/breakdowns, hilliness/linked hilliest activities, cumulative curves and 12-period/all-year history. Query arguments are explicit; chart dimensions, selection and shared browsing dates cannot enter this scope. Suppressed catalogue entries stay suppressed; optional unspecified Speed trend has no invented calculation.

The immutable `StatsEngine` indexes metadata by activity-local day and category, with prefix sums for logarithmic range totals. Metadata/filter work is reused by revision. The controller coalesces identical demand and serializes expensive index/result jobs. Only the current still-valid index request copies the library; obsolete waiters hold no full-library copy. Sixteen exact query/date outputs cap retained chart buffers. Production UI consumers use `result` to reuse expensive records, hilliness and series; `engine` exposes the immutable index for fixture conformance and specialized calculations.

Activity replacement/upsert/tombstone changes the existing store revision; logout/account/deployment/expiry clears and fences Stats through `ActivityStore.clearScope()`. Completion checks verify epoch, revision, non-date predicates and reporting day before returning derived output. Foreground and the existing minute refresh update device-local today. Day/timezone changes reuse the metadata index but recompute affected windows. Dates of activities remain their encoded wall-clock days.

No Stats API accepts a loader, coordinates, photos, compact streams or raw streams. Filtering/indexing copies metadata only. Record/calendar ties use start and stable identity; anonymous synthetic ties retain input order after identified rows. Scatter/hill ties retain supplied order independently of record ordering.

Tests consume both unchanged shared corpora through production methods: all 54 additional vectors plus the original multi-sport-year fields. Integration tests exercise real SyncController/LocalStore edit, deletion, atomic rebootstrap, account and deployment transitions, authorized old cache/failure/partial states, elapsed/moving separation and reset. A 20,000-activity regression checks index/result reuse, date/selection independence, bounded history buffers and absent resource metadata; named-device release budgets remain #229.

## Dashboard consumer — #263 / #254

`StatsScreen` is registered by default through `BrowseStatsDestination.dashboard`. The shell retains it alongside Map/List and recreates it on scope reset. `StatsDashboardState` owns per-tile choices and the single expanded tile, separately from browsing filters/selection. Dashboard demand starts when Stats is selected and authorized matching content exists; merely mounting the retained destination does not start queries.

A compound `StatsQuery.dashboard(tile, option)` returns a typed `StatsDashboardResult` built by the existing immutable engine. Each tile uses one controller-cache entry, so the ten-tile overview fits within its sixteen-entry bound even when a face combines comparisons and chart series. No view body performs aggregation. Results are tagged by scope revision, activity revision, non-date filter scope, reporting day and exact tile option; a stale result is hidden immediately and cannot publish across a changed request.

The visible tile set and defaults are checked against `shared/stats-capabilities.v1.json`. Calendar defaults to Sport; sport mix defaults to This year. Consistency is not rendered or requested by the dashboard; its catalogue ID, calculation and fixtures remain for compatibility. Typical week retains active days per week, and Activity calendar retains the activity pattern. Metric choices use the generated catalogue order. Current scope and loading/cache/error state come from `StatsPresentation`, with recovery routed to the existing shell/sync controller. Charts supply labelled data and native touch inspection. Overview expansion retains tile choices and makes charts larger; Records also reveals all-time records and Sport mix reveals metric totals. The reviewed implementation includes volume grouping, past calendar years, best-30-day Records and identity-based activity drill-down. Month/year comparisons retain current versus previous with historical context bands; historical period paging is intentionally omitted.
