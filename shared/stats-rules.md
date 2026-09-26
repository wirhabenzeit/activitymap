# Stats tile rules

Web and iOS draw the stats tiles with their own code. This page pins every rule where two independent implementations could quietly disagree. `shared/stats-fixtures/*.json` turns these rules into numbers: each platform computes the fixture's activities and must match `expected`.

## Dates

- An activity's day is the calendar date of `start_date_local` read as wall-clock time. The API encodes that wall-clock time as if it were UTC, so on the web use the UTC fields (`getUTCDate`, `d3.utcDay`), and on iOS use a calendar with `TimeZone(identifier: "UTC")`. Never convert to the device time zone.
- "Today" is the device's local calendar date. Fixtures pin it with `today`.
- Weeks start on Monday.
- Windows include today:
  - `yearToDate`: 1 January through today. The comparison year runs from 1 January through the same month and day (28 February when today is 29 February).
  - `currentYear`: the same as `yearToDate` for the current year.
  - `monthToDate`: the 1st of this month through today. The comparison runs from the 1st of last month through the same day number, capped at that month's last day.
  - `last12Weeks` / `last52Weeks`: the current, partial week and the 11 (or 51) full weeks before it.
  - `last12Months`: the 365 days ending today.
  - `allTime`: every activity.

## Metrics

- `count`: activities.
- `distance`: kilometres (API metres ÷ 1000).
- `elevation`: metres of `total_elevation_gain`.
- `time`: hours of `moving_time` (API seconds ÷ 3600).
- A missing value counts as 0. The activity still counts toward `count` and active days.

## Sports

Sport means the category from `src/settings/category.tsx` on the web and `ActivityCategory` on iOS: `bcXcSki`, `trailHike`, `run`, `ride`, `misc`.

## Tiles

- **yearToDate**: the chosen metric summed over `yearToDate` for this year (`current`) and last year (`previous`).
- **totals**: all four metrics over `currentYear`.
- **weeklyVolume**: the chosen metric per week over `last12Weeks`, oldest first. The last bar is the current, partial week.
- **activityCalendar**: `activeDays` is the number of days in `last12Months` with at least one activity. A day's dominant sport is the one with the most moving time. Ties go to the order in the Sports list above.
- **monthVsLastMonth**: the chosen metric over `monthToDate` for this month (`current`) and last month (`previous`).
- **sportMix**: each sport's share of moving time over the chosen range, largest first. Sports with no moving time are left out.
- **consistency**: `activeDaysPerWeek` is the mean number of active days per full week, over the full weeks of the range (11 for `last12Weeks`). The current, partial week is not counted. `currentStreak` counts consecutive active days, ending today, or yesterday when today has no activity yet.
- **distanceVsElevation**: one point per activity with a distance above 0 in `last12Months`. `metersPerKm` is the total elevation of those points divided by their total distance.
- **speedTrend**: optional and not specified yet. It gets rules and fixtures before either platform builds it.

Fixture numbers are compared with a tolerance of 0.000001.
