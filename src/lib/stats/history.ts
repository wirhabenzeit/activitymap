import {
  dayOf,
  metricValue,
  mondayOf,
  sportOrder,
  compareStatsActivities,
  type StatsActivity,
  type Sport,
} from './tile-data';
import { dateOfDay, monthStart, yearStart } from './tile-series';
import { type StatsMetric } from '~/settings/stats-tiles.generated';

export type HistoryRange = 'weeks' | 'months' | 'years';
export type HistoryBucket = {
  start: number;
  end: number;
  total: number;
  bySport: Record<Sport, number>;
};

export function firstActivityDay(
  activities: readonly StatsActivity[],
  today: number,
) {
  return activities.reduce(
    (first, activity) => Math.min(first, dayOf(activity.start_date_local)),
    today,
  );
}

// Pages contain twelve calendar periods, including the current partial one.
// All-years includes empty years so gaps in training remain visible.
export function volumeHistory(
  activities: readonly StatsActivity[],
  today: number,
  metric: StatsMetric,
  range: HistoryRange,
  page = 0,
  leadingPeriods = 0,
): HistoryBucket[] {
  const date = dateOfDay(today);
  const year = date.getUTCFullYear();
  const firstYear = dateOfDay(
    firstActivityDay(activities, today),
  ).getUTCFullYear();
  const leading = Math.max(0, Math.floor(leadingPeriods));
  const count = (range === 'years' ? year - firstYear + 1 : 12) + leading;
  const offset = Math.max(0, Math.floor(page)) * 12;
  const starts = Array.from({ length: count + 1 }, (_, index) =>
    range === 'weeks'
      ? mondayOf(today) + (index - 11 - offset - leading) * 7
      : range === 'months'
        ? monthStart(year, date.getUTCMonth() + index - 11 - offset - leading)
        : yearStart(firstYear + index - leading),
  );
  const buckets = starts.slice(0, -1).map((start, index) => ({
    start,
    end: Math.min(today, starts[index + 1]! - 1),
    total: 0,
    bySport: Object.fromEntries(
      sportOrder.map((sport) => [sport, 0]),
    ) as Record<Sport, number>,
  }));
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    const bucket = buckets.find(
      (bucket) => day >= bucket.start && day <= bucket.end,
    );
    if (!bucket) continue;
    const value = metricValue(activity, metric);
    bucket.total += value;
    bucket.bySport[activity.sport] += value;
  }
  return buckets;
}

// Use history outside the viewport. Never let the unfinished period lower the
// trend: at its x position, carry the average of the four preceding full periods.
export function volumeHistoryAverage(
  activities: readonly StatsActivity[],
  today: number,
  metric: StatsMetric,
  range: HistoryRange,
) {
  const history = volumeHistory(activities, today, metric, range, 0, 4);
  const firstKnownDay = firstActivityDay(activities, today);
  return history.slice(4).flatMap((bucket, visibleIndex) => {
    const index = visibleIndex + 4;
    const end = index === history.length - 1 ? index - 1 : index;
    const window = history.slice(end - 3, end + 1);
    if (!activities.length || window[0]!.end < firstKnownDay) return [];
    return [
      {
        x: String(bucket.start),
        value: window.reduce((sum, row) => sum + row.total, 0) / 4,
      },
    ];
  });
}

export function calendarDays(
  activities: readonly StatsActivity[],
  first: number,
  last: number,
) {
  const days = new Map<number, StatsActivity[]>();
  const dominantSport = new Map<number, Sport>();
  const mixedDays = new Set<number>();
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day < first || day > last) continue;
    const rows = days.get(day) ?? [];
    rows.push(activity);
    days.set(day, rows);
  }
  for (const [day, rows] of days) {
    rows.sort(compareStatsActivities);
    const times = new Map<Sport, number>();
    for (const row of rows)
      times.set(
        row.sport,
        (times.get(row.sport) ?? 0) + (row.moving_time ?? 0),
      );
    // Match the shared calendar rule even when input order differs.
    dominantSport.set(
      day,
      [...times].sort(
        (a, b) =>
          b[1] - a[1] || sportOrder.indexOf(a[0]) - sportOrder.indexOf(b[0]),
      )[0]![0],
    );
    if (times.size > 1) mixedDays.add(day);
  }
  return { days, dominantSport, mixedDays };
}
