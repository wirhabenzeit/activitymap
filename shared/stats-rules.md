# Stats tile rules

Web and iOS draw the stats tiles with their own code. This page pins every rule where two independent implementations could quietly disagree. `shared/stats-fixtures/*.json` turns these rules into numbers: each platform computes the fixture's activities and must match `expected`.

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
  - `allTime`: every activity.

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
- **weeklyVolume** (Training volume): the metric per week over `last12Weeks`, oldest first. The last bar is the current, partial week. `lastFourWeeks.current` is the metric over the 28 days ending today; `previous` is the 28 days before those.
- **monthVsLastMonth**: the chosen metric over `monthToDate` for this month (`current`) and last month (`previous`).

### This year

- **yearToDate**: the chosen metric summed over `yearToDate` for this year (`current`) and last year (`previous`).
- **yearPace**: `current` is the metric over `yearToDate`. `perDay` divides it by the number of days from 1 January through today. `projected` is `perDay` times the number of days in this year. `lastYear` is the metric over the whole previous calendar year.
- **records**: over `currentYear`, or over `allTime` for the second row: the single activity with the most distance, the most moving time and the most elevation, and the Monday-to-Sunday week with the most distance. A record needs a value above 0, and a tie goes to the earlier activity or week.
- **totals**: all four metrics over `currentYear`. Optional: the web folds these into yearToDate and yearPace and does not draw this tile.

### Patterns

- **activityCalendar**: `activeDays` is the number of days in `last12Months` with at least one activity. A day's dominant sport is the one with the most moving time. Ties go to the order in the Sports list above.
- **consistency**: over the full weeks of the chosen range (11 for `last12Weeks`, 51 for `last52Weeks`), `activeDaysPerWeek` is the mean number of active days per week and `solidWeeks` counts the weeks with at least five active days. `currentStreak` counts consecutive active days, ending today, or yesterday when today has no activity yet.
- **sportMix**: each sport's share of moving time over the chosen range, largest first. Sports with no moving time are left out.
- **distanceVsElevation** (Climbing): one point per activity with a distance above 0 in `last12Months`. `metersPerKm` is the total elevation of those points divided by their total distance. `climbing.current` is the same per 100 km; `climbing.previous` is the same over the 12 months before `last12Months` (from the same date two years ago through the day before `last12Months` starts). `climbing.months` gives it for each calendar month, the 11 before this one and this one through today; a month without distance has 0.
- **typicalWeek**: the mean per full week of each metric and of active days.
- **best30Days**: the 30-day window with the largest total of the metric, among windows that start on or after 1 January of this year and end by today; a tie goes to the earlier window. Before 30 January the only window is 1 January through today. `current` is the metric over the 30 days ending today.
- **restDays**: the number of days without an activity among the last 30 days (today included) and among `last90Days`.
- **speedTrend**: optional and not specified yet. It gets rules and fixtures before either platform builds it.

Fixture numbers are compared with a tolerance of 0.000001.

## Chart dates

Year-comparison charts align calendar month/day on the leap reference year 2000. February 29 has a point only in leap years; March 1 and December 31 align in every year. The rolling-year calendar includes both partial boundary months (normally 13 month rows), with cells outside its inclusive window blank.

## Activity scope

Tiles respect sport, search, numeric and binary activity filters for both the reporting window and all comparisons. The shared sidebar date range does not remove history from tiles: each tile owns its period. The web replaces the date picker on Tiles with an explanation and preserves its value for the other views. A visible filter summary and reset apply to activity scope only. Filtered rest days and consistency carry a fixed explanation that only matching activities are counted; titles do not change with individual filter combinations. Sport mix retains its position and explains a single-category scope. Missing/loading history is not presented as recorded inactivity.

## Presentation

Every declared tile switch is available on the web, with the manifest's first option as its default. Expanding a tile preserves the selected metric or range, including Consistency and Sport mix. Calendar metric colouring uses a linear scale from zero to the largest daily value in its window. Time always means moving time; sidebar duration thresholds still mean elapsed time. Narrow layouts use the manifest's single-column grid. The web stats page uses tiles only. Expanded Training volume pages through 12-week or 12-month windows, or shows all years, including empty periods. Expanded Activity calendar supports calendar-year navigation and day activity details; striped sport cells indicate multiple sport groups. Expanded year and month comparisons can navigate earlier periods. These historical controls use the same activity filters and moving-time metric as the compact tiles, without applying the shared date filter.

On the web, expansion is available only through the corner button and only one tile can be expanded at a time. This week, Year-end projection, Typical week and Best 30 days have no expansion button. Other visible tiles expand for history, additional details or easier chart inspection. Closing a tile preserves its history navigation while the stats page remains mounted. The web consolidates Rest days into Consistency and does not draw a separate Rest days tile. Consistency shows one bar per week on a fixed 0–7 active-day scale, including empty weeks. The current week is marked incomplete and excluded from the headline average. Both sizes retain the 12-/52-week switch; expansion adds labelled axes and an accessible table of weekly counts. The expanded 52-week chart scrolls horizontally on narrow screens to keep individual bars inspectable. The web does not show the five-active-day threshold summary.
