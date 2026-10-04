# Stats tile rules

Web and iOS draw the stats tiles with their own code. This page pins every rule where two independent implementations could quietly disagree. `shared/stats-fixtures/*.json` turns these rules into numbers: each platform computes the fixture's activities and must match `expected`. The #261 [migration contract](../docs/stats-parity-contract.md), [capability matrix](stats-capabilities.v1.json) and [additional parity fixtures](stats-parity-fixtures.v1.json) pin visible UI, history/scope cases and the native handoff separately from the raw catalogue.

## Dates

- An activity's day is the calendar date of `start_date_local` read as wall-clock time. The API encodes that wall-clock time as if it were UTC, so on the web use the UTC fields (`getUTCDate`, `d3.utcDay`), and on iOS use a calendar with `TimeZone(identifier: "UTC")`. Never convert to the device time zone.
- "Today" is the device's local calendar date. Fixtures pin it with `today`.
- Weeks start on Monday.
- Windows include today:
  - `currentWeek`: Monday of this week through today.
  - `yearToDate`: 1 January through today. The comparison year runs from 1 January through the same month and day (28 February when today is 29 February).
  - `currentYear`: the same as `yearToDate` for the current year.
  - `monthToDate`: the 1st of this month through today. The comparison runs from the 1st of last month through the same day number, capped at that month's last day.
  - `last12Weeks` / `last52Weeks`: the current, partial week and the 11 (or 51) full weeks before it.
  - `last90Days`: the 89 days before today and today.
  - `last12Months`: the same calendar date one year earlier (28 February for 29 February) through today, matching the filter preset in `docs/map-list-parity-contract.md`.
  - `allTime`: every activity through the reporting date; future activities are excluded.

## Metrics

- `count`: activities.
- `distance`: kilometres (API metres ÷ 1000).
- `elevation`: metres of `total_elevation_gain`.
- `time`: hours of `moving_time` (API seconds ÷ 3600).
- Sums add the known values, and a missing value adds nothing. The activity still counts toward `count` and active days. Unlike the list summary in `docs/map-list-parity-contract.md`, a tile whose activities all lack a metric shows 0 instead of unknown.

## Sports

Sport means the category from `src/settings/category.tsx` on the web and `ActivityCategory` on iOS: `bcXcSki`, `trailHike`, `run`, `ride`, `misc`.

## Tiles

Unless a rule says otherwise, a tile's metric is the one its switch shows, and "full weeks" means the 11 full weeks of `last12Weeks` before the current, partial week.

### Now

- **thisWeek**: the metric per day of `currentWeek`, Monday first, with `null` for the days after today. `current` is their sum. `typical` is the mean, over the full weeks, of each week's total from Monday through today's weekday, so an unfinished week is compared with the same part of a typical week.
- **weeklyVolume** (Training volume): the metric per week over `last12Weeks`, oldest first. The last area segment is the current, partial week. `lastFourWeeks.current` is the metric over the 28 days ending today; `previous` is the 28 days before those. This rolling headline includes current-week activity; the chart average separately uses completed calendar weeks.
- **monthVsLastMonth**: the chosen metric over `monthToDate` for this month (`current`) and last month (`previous`).

### This year

- **yearToDate**: the chosen metric summed over `yearToDate` for this year (`current`) and last year (`previous`).
- **yearPace**: `current` is the metric over `yearToDate`. `perDay` divides it by the number of days from 1 January through today. `projected` is `perDay` times the number of days in this year. `lastYear` is the metric over the whole previous calendar year.
- **records**: over `currentYear`, or over `allTime` for the second row: the single activity with the most distance, the most moving time and the most elevation, and the Monday-to-Sunday week with the most distance. A record needs a value above 0. Ties use earlier wall-clock start, then lower activity ID for identical starts. Identified rows precede anonymous synthetic rows at an identical start; anonymous ties retain supplied order. Week ties use earlier week start. Current-year membership clips at January 1 even when the week starts in December. Calendar day lists use the same start/identity order.
- **totals**: all four metrics over `currentYear`. Optional: the web folds these into yearToDate and yearPace and does not draw this tile.

### Patterns

- **activityCalendar**: `activeDays` is the number of days in `last12Months` with at least one activity. A day's dominant sport is the one with the most moving time. Ties go to the order in the Sports list above.
- **consistency** (retained calculation only; no visible tile on either platform): over the full weeks of the chosen range (11 for `last12Weeks`, 51 for `last52Weeks`), `activeDaysPerWeek` is the mean number of active days per week and `solidWeeks` counts the weeks with at least five active days. `currentStreak` counts consecutive active days, ending today, or yesterday when today has no activity yet.
- **sportMix**: each sport's share of moving time over the chosen range, largest first. Sports with no moving time are left out.
- **distanceVsElevation** (Hilliness): one point per activity with a distance above 0 in `last12Months`. `metersPerKm` is the total elevation of those points divided by their total distance. `climbing.current` is the same per 100 km; `climbing.previous` is the same over the 12 months before `last12Months` (from the same date two years ago through the day before `last12Months` starts). `climbing.months` gives it for each calendar month, the 11 before this one and this one through today; a month without distance has 0. Both dashboards divide the per-100-km calculation values by 100 for display in m/km; fixtures retain the existing calculation units.
- **typicalWeek**: the mean per full week of each metric and of active days.
- **best30Days**: the 30-day window with the largest total of the metric, among windows that start on or after 1 January of this year and end by today; a tie goes to the earlier window. Before 30 January the only window is 1 January through today. `current` is the metric over the 30 days ending today.
- **restDays**: the number of days without an activity among the last 30 days (today included) and among `last90Days`.
- **speedTrend**: optional and not specified yet. It gets rules and fixtures before either platform builds it.

Fixture numbers are compared with a tolerance of 0.000001.

## Chart dates

Year-comparison charts align calendar month/day on the leap reference year 2000. February 29 has a point only in leap years; March 1 and December 31 align in every year. The rolling-year calendar includes both partial boundary months (normally 13 month rows), with cells outside its inclusive window blank.

## Activity scope

Tiles respect sport, search, numeric and binary activity filters for both the reporting window and all comparisons. The shared sidebar date range does not remove history from tiles: each tile owns its period. Both platforms hide the date picker in Stats and preserve its value for the other views, without a permanent period disclaimer or unfiltered “All activities” banner. A filter summary and reset appear only when activity filters are active; reset preserves the saved date range. Titles do not change with individual filter combinations. Sport mix retains its position and explains a single-category scope. Missing/loading history is not presented as complete recorded inactivity; nonempty partially loaded history is disclosed as potentially incomplete.

## Presentation

Every visible tile's declared switch is available on the web, with the manifest's first option as its default. Expanding a tile preserves the selected metric or range, including Sport mix. Calendar metric colouring uses a linear scale from zero to the largest daily value in its window. Time always means moving time; sidebar duration thresholds still mean elapsed time. Narrow layouts use the manifest's single-column grid. The web stats page uses tiles only. Expanded Training volume offers By week (last 12 weeks), By month (last 12 months), and By year (all available years), including empty periods. It uses stacked area by sport, a four-completed-period average in every grouping (including offscreen history), lighter incomplete-period shading, and period totals by sport. A period remains incomplete through its final calendar day and becomes complete at the start of the next period. It is also incomplete when the filtered history begins partway through it, such as the first year of a history that starts in October. There is no chart-type or historical-window selector. Expanded Activity calendar supports calendar-year navigation and inline day activity details with a selected-cell outline on both platforms; striped sport cells indicate multiple sport groups, alternating the dominant sport color with the runner-up sport by moving time (same tie-break). Expanded year and month comparisons retain current versus immediately previous period, with larger charts and historical bands rather than a historical-period selector. Month bands use the 5th–95th percentile across all completed months; year bands use min–max across completed years. Exclude the current and incomplete opening periods, retain empty completed periods, and require two samples. Forward-fill shorter months through day 31 and non-leap years through February 29. Quantiles interpolate linearly at `(n - 1) * p`. These historical controls use the same activity filters and moving-time metric as the compact tiles, without applying the shared date filter.

On the web, expansion is available only through the corner button and only one tile can be expanded at a time. This week, Year-end projection and Typical week have no expansion button. Other visible tiles expand for history, additional details or easier chart inspection. Closing a tile preserves its metric, grouping and calendar/record choices while the stats page remains mounted. Neither platform displays Consistency or Rest days. Their catalogue IDs and calculations remain specified/tested for compatibility, but do not require dashboard queries, range controls, charts or tables. The accepted Consistency removal on 2026-10-04 leaves ten visible tiles; Typical week retains active days per week and Activity calendar retains the visual activity pattern.

On the web, Typical week remains a standalone textual summary. Best 30 days is shown inside expanded Records for distance, moving time and elevation, retaining the latest-30-day comparison. Before January 30 it explains that no complete 30-day window exists within the year and shows no partial-window comparison. Year-end projection leads with the projected year-end total; daily average and last-year totals provide context. Training volume labels its compact chart as a 12-week trend and its headline as the last 28 days; expanded history labels its total by the displayed window. Metric switches follow distance, moving time, elevation, then activity count where available, with distance as the default; calendar colouring keeps Sport as its default.
