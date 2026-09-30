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
): HistoryBucket[] {
  const date = dateOfDay(today);
  const year = date.getUTCFullYear();
  const firstYear = dateOfDay(
    firstActivityDay(activities, today),
  ).getUTCFullYear();
  const count = range === 'years' ? year - firstYear + 1 : 12;
  const offset = Math.max(0, Math.floor(page)) * 12;
  const starts = Array.from({ length: count + 1 }, (_, index) =>
    range === 'weeks'
      ? mondayOf(today) + (index - 11 - offset) * 7
      : range === 'months'
        ? monthStart(year, date.getUTCMonth() + index - 11 - offset)
        : yearStart(firstYear + index),
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
