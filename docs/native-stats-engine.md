# Native Stats calculation handoff

Issue #262 implements calculations and history data from the [accepted Stats contract](stats-parity-contract.md). The visible dashboard, controls and expansion remain #263/#264; styling remains #265. The legacy Stats views are still unreachable from the Map/List shell and are not a parity dashboard.

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
