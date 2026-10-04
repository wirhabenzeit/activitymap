# Stats migration contract

Issue [#261](https://github.com/wirhabenzeit/activitymap/issues/261), audited 2026-09-30 against merged web `bfe24d852bdd89676131e43e2a6e6cf6de285319` (#239, #248, #250). This extends the existing [stats rules](../shared/stats-rules.md) and fixtures. It does not change the [map/list contract](map-list-parity-contract.md) or certify native implementation/device acceptance.

The web uses `/stats/tiles` only. The #263/#254 working revision integrates the native dashboard into Map/List/Stats navigation. Following the accepted Consistency removal on 2026-10-04, the fifteen-entry catalogue defines ten visible dashboard tiles on each platform. The [machine-readable capability matrix](../shared/stats-capabilities.v1.json) records all entries, visibility, section order, defaults, expansion and implementation/UI owners. `stats-tiles:check` validates it against the catalogue; rendered tests check it against actual views.

The accepted 2026-10-04 review also supersedes the original history navigation and chart presentation: current month/year compare with the immediately previous period and add historical bands; Training volume uses fixed recent groupings; Hilliness displays m/km. Consistency is removed from presentation, including its 12/52-week picker and weekly chart/table, while its calculation contract and fixtures remain. This update does not certify merge or device acceptance.

## Capability and ownership matrix

All calculations/series belong to **#262**, overview/switches to **#263**, historical/detail interactions to **#264**, and UI alignment to **#265**, designed in **#252** using components from **#253**. #254 owns the common navigation/filter integration interface. Metric switches use Distance, Moving time, Elevation, then Activities where supported; Distance is default. Calendar defaults to Sport.

| Section   | Visible tile / ID                      | Switch                                 | Compact meaning                                                                                                | Expanded behavior                                                                                     |
| --------- | -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Now       | This week / `thisWeek`                 | distance/time/elevation                | Monday-first days, future days unavailable; sum so far versus typical same weekday                             | None                                                                                                  |
| Now       | Training volume / `weeklyVolume`       | distance/time/elevation/count          | Last 4 full weeks versus the 4 before; 12-week trend and four-full-week average                                | By week (last 12), By month (last 12), By year (all); stacked area, four-full-period average and totals by sport                            |
| Now       | This month / `monthVsLastMonth`        | distance/time/elevation/count          | Month-to-date versus same day in prior month, capped at month end                                              | Same current/prior-month curves at larger size; historical 5th–95th percentile band; no past-month selector                                 |
| This year | Year to date / `yearToDate`            | distance/time/elevation/count          | Current-year total versus same date last year; aligned cumulative curves                                       | Same current/prior-year curves at larger size; historical min–max band; no additional selected years                                      |
| This year | Year-end projection / `yearPace`       | distance/time/elevation                | Projected annual total, daily mean, whole prior-year context                                                   | None                                                                                                  |
| This year | Records / `records`                    | None                                   | Current-year distance/moving-time/elevation activity records and greatest-distance week; no competing headline | All-time records, activity links, best complete 30-day windows and latest-30-day comparison           |
| Patterns  | Activity calendar / `activityCalendar` | sport/distance/time/elevation          | Inclusive rolling year, active days, month rows, day details, visible legend                                   | Rolling or selected year, previous/next year, mixed-day cues, activity links                          |
| Patterns  | Sport mix / `sportMix`                 | currentYear/allTime; first default     | Moving-time shares, fixed position, single-sport explanation                                                   | Share/count/distance/elevation/moving-time breakdown table                                            |
| Patterns  | Hilliness / `distanceVsElevation`      | None                                   | Metres climbed per km versus preceding rolling year, monthly trend                                         | Larger chart, five hilliest activities with at least 5 km, linked to detail                           |
| Patterns  | Typical week / `typicalWeek`           | None                                   | Mean moving hours, active days and other metrics over eleven full weeks                                        | None                                                                                                  |

Suppressed entries are explicit: `totals` has no separate view; `best30Days` appears inside expanded Records; `consistency` and `restDays` are not displayed on either platform; `speedTrend` is optional and unspecified. Catalogue presence does not require extra screens. Consistency and Rest days retain their catalogue IDs, calculations and historical fixtures for compatibility, but have no native or web presentation requirement. Typical week retains active days per week, and Activity calendar supplies the visual activity pattern.

## Scope, dates and values

- Use complete authorized metadata matching sport/search/numeric/binary restrictions before each reporting/comparison window, not selected IDs, GPS-only/map-visible rows, pagination or instantiated cells.
- Retain the saved map/list date range but ignore it in Stats. Hide its picker in Stats without a permanent period disclaimer or unfiltered “All activities” banner. Show the activity-filter summary/reset only when filters are active. Clearing **activity filters** restores sport/search/numeric/binary defaults and preserves the date range, selection and camera/list context.
- `start_date_local` is wall-clock time encoded as UTC, not an instant to convert into the viewer timezone. Today is device-local. Foreground/day changes update reporting windows without changing activity dates.
- Weeks start Monday. Reporting includes today and excludes future activities. Current-year records clip membership at January 1 even when the containing week starts in December; all-time includes older activities through today.
- Stats time is **moving time**, seconds ÷ 3,600. Duration restrictions remain **elapsed time**. Distance is km, elevation is m. Activity count/active days include rows with missing measurements.
- Known values sum; missing adds nothing. A complete all-unknown metric scope sums to zero. Records need positive values; no moving time means no sport shares. The UI may show a dash/explanation instead of inventing a positive record. List summary unknown/coverage semantics remain distinct.
- Current month/year compare through the same elapsed date in the immediately previous period, clamping February 29 and shorter prior months. The dashed curve continues through the completed previous period; expansion keeps this same comparison.
- Historical bands use completed periods after the first recording, excluding an incomplete opening period and the current period; at least two periods are required. Months use pointwise 5th/95th percentiles across all historical months (not only the same named month), with linear interpolation at `(n - 1) * p`. Shorter months forward-fill their final cumulative total through day 31. Years use min/max, with February 28 carried into February 29 for non-leap years. Empty completed periods remain in the population.
- Training volume averages four completed periods for every grouping, using preceding offscreen history from the first visible point. The current incomplete period is excluded from its average and gets a lighter area segment. Grouping controls appear in the expanded tile; period totals break down by sport. No chart-type picker or paged-window navigator is shown.
- Year chart x coordinates align on leap year 2000; non-leap curves omit February 29. Empty history buckets remain. Incomplete loaded history has explicit disclosure, not certification that every zero bucket was inactivity.
- Record ties use earlier wall-clock start, then lower activity ID for identical starts. Identified rows precede anonymous synthetic rows at equal starts; anonymous ties retain supplied order. Greatest-week/best-window ties use earliest start. Calendar moving-time and sport-share ties use shared category order independently of input order.
- Compare unrounded numeric leaves at absolute tolerance `0.000001`. Web displays whole count/distance/elevation, moving hours to one decimal below 10 and whole hours otherwise; locale separators can differ. No percentage change when the previous value is zero; never show NaN/Infinity.

Full formulas, inclusive windows and colour rules remain in [shared/stats-rules.md](../shared/stats-rules.md). Each native fixture must run through production calculations rather than copying expected results.

## Interaction and native adaptation

| Web behavior                                                     | Required native outcome                                                                                                          | Owner          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Map/List/Stats routes                                            | Accepted primary navigation; returning retains camera/selection, list offset and mounted stats context                           | #252/#254/#263 |
| Explicit corner expansion, one tile at a time                    | Accessible expand/collapse; inline or adaptive host agreed in #252                                                               | #264/#265      |
| Switch/outside interaction does not expand/collapse              | Controls and scrolling retain context; selecting another tile changes expansion                                                  | #264           |
| Collapse preserves metric/range/history while mounted            | Keep choices/return position through expansion and destination changes while mounted; no new cross-launch preference requirement | #263/#264      |
| Escape closes expansion, not a simultaneously open detail dialog | Correct dismiss/back and focus ownership for nested presentations                                                                | #264/#265      |
| Hover chart values; expanded axes/tables                         | Touch inspection and accessible labelled values/table equivalents, preserving units/periods/partial markers                      | #264/#265      |
| Desktop 4/2/1-column grid and varied spans                       | Readable adaptive phone/iPad hierarchy; complete content rather than copied fixed heights                                        | #252/#265      |
| Calendar day buttons and arrow-key navigation                    | Direct touch and accessible day navigation, including empty days; no removed Open day date-picker form                           | #264/#265      |
| Legend remains visible during day selection                    | Selected day is outlined; details appear inline on both platforms beside the persistent legend; mixed-sport cues                                                    | #265           |
| Record/calendar/hilliest activity links                          | Reuse #257 detail by identity without implicit map/list selection; dismiss restores stats context                                | #257/#264      |
| Explicit Show on map                                             | Existing hidden-filter confirmation/no-GPS behavior; no silent filter clearing                                                   | #264           |
| Reduced-motion expansion/retained scroll anchor                  | Native reduced motion and focus/scroll return, avoiding animation that competes with user scrolling                              | #265           |

## Design reference cases

These are prototype/capture inputs for #252 and later #265/#228 review, not accepted native layouts or device evidence. Match dataset/date across platforms; include small phone, landscape, iPad, light/dark and accessibility text. Screenshots/device acceptance remain pending.

| ID  | Data/state setup                                                        | Observable baseline / native requirement                                                            |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| S0  | `empty-complete-history`, query still fetching/has more pages, no error | Loading history rather than empty-library or inactivity certification                               |
| S1  | Same fixture, query complete, no filters/error                          | No activity history rather than a dashboard claiming measured inactivity                            |
| S2  | `sparse-null-zero-and-ties`, no sports selected, query complete         | No matching activities; reset preserves saved browsing dates                                        |
| S3  | Same sparse fixture, nonempty data still fetching/has next page         | Dashboard plus incomplete-comparison/loading-more disclosure                                        |
| S4  | Same authorized cache, refetch error/offline                            | Error/retry with retained content; no false expiry or time-based data eviction                      |
| S5  | Same valid old cache versus real expiry/account change                  | Old authorized data usable; genuine invalidation clears/fences derived stats                        |
| S6  | `leap-and-sparse-history`, expanded calendar/year history               | Visible legends, mixed-day labels, empty years, leap alignment; day → activity → return             |
| S7  | `year-boundary-record-ties`, Records/Training volume expanded           | Identity-stable records, cross-year weeks, partial markers; no full 30-day comparison before Jan 30 |
| S8  | Sparse fixture, Ride/search/elapsed restrictions with saved March dates | Older comparisons retained; time means moving; reset retains March for map/list                     |
| S9  | Overview, expanded Training volume and Activity calendar                     | All essential controls/legends reachable at large text; touch/VoiceOver review remains #228         |

Source audit pins the current query composition: error shows retry; empty error does not also claim an empty library; empty non-error loading/fetching/next-page data shows loading; complete empty data distinguishes no matches from no history; nonempty data remains visible and discloses fetching/more pages. Native cache/expiry ownership stays under existing sync lifecycle and #258. Incomplete history disclosure is not complete numeric coverage.

## Executable fixture handoff

Retain [multi-sport-year.json](../shared/stats-fixtures/multi-sport-year.json), covering original formulas. The additional language-independent corpus is [stats-parity-fixtures.v1.json](../shared/stats-parity-fixtures.v1.json), with four datasets and pinned expected cases: complete empty history; missing/zero metrics, filtered comparisons and sport/record ties; leap/local-time boundaries and historical gaps/pages; cross-year membership and identical-start record ties.

Each case names a production operation and arguments. Today defaults to fixture today; metric to distance; range to currentYear (volume history defaults to weeks); weeks to 12; page to zero; first/last to today. Filter arguments apply first and preserve supplied state. `localToday` takes a specified instant and IANA device timezone, independently of activity-local timestamps.

Dates normalize to `YYYY-MM-DD`; day maps use date keys and list activity IDs in start/identity order. Records contain value/day/activityId or value/weekStart. Series/buckets retain every element, including zero; coordinates use date or leap-reference x; `bySport` includes every category. Compare exact key sets, IDs, booleans, nulls, dates and array lengths, with tolerance only for numeric leaves. Future-day null must not become zero.

Schema validation is in `scripts/lib/stats-parity-schema.ts` and `stats-tiles:check`. Numerical/series/scope cases run in `src/lib/stats/parity-fixtures.test.ts`; visibility/expansion in `src/components/stats/tiles/views.test.tsx`. Existing reset tests prove date preservation. Both corpora feed #262; capability/reference matrices feed #252. Full journeys, named-device/accessibility and performance stay #227/#228/#229.

## Audit resolutions and scope

The audit resolves three ambiguities with focused regressions: document actual Rest days visibility; align calendar history with the existing sport tie rule; resolve identical record/day timestamps by stable ID instead of API order. The last clarification changes only equal-timestamp outcomes and is explicitly pinned in shared rules/fixtures.

The original #261 handoff is now extended by the reviewed #263/#254 implementation and cross-platform reconciliation. No raw stream fetching, backend API or auth/sync rewrite is introduced. Named-device accessibility and measured release performance remain separate acceptance work under #228/#229.
