// Chart series behind the stats tiles and their detail views. The headline
// numbers come from tile-data.ts, which the shared fixtures pin; these
// helpers only shape the same activities into points to draw, following the
// date rules in shared/stats-rules.md.

import { type StatsMetric } from '~/settings/stats-tiles.generated';
import { aliasMap } from '~/settings/category';
import { type Activity } from '~/server/db/schema';

import {
  dayOf,
  sameDateLastYear,
  metricValue,
  mondayOf,
  sportOrder,
  type Sport,
  type StatsActivity,
} from './tile-data';

const millisecondsPerDay = 86_400_000;

// Count calendar days, not activities; keep empty weeks and the partial current week.
export function weeklyActiveDays(
  activities: readonly StatsActivity[],
  today: number,
  weeks: 12 | 52,
) {
  const currentWeek = mondayOf(today);
  const first = currentWeek - (weeks - 1) * 7;
  const activeDays = new Set(
    activities
      .map((activity) => dayOf(activity.start_date_local))
      .filter((day) => day >= first && day <= today),
  );
  return Array.from({ length: weeks }, (_, index) => {
    const start = first + index * 7;
    return {
      start,
      activeDays: Array.from({ length: 7 }, (_, day) => start + day).filter(
        (day) => activeDays.has(day),
      ).length,
      partial: start === currentWeek,
    };
  });
}

export function toStatsActivity(activity: Activity): StatsActivity {
  return {
    id: activity.id,
    name: activity.name,
    sport: aliasMap[activity.sport_type] ?? 'misc',
    start_date_local: new Date(activity.start_date_local),
    distance: activity.distance,
    moving_time: activity.moving_time,
    total_elevation_gain: activity.total_elevation_gain,
  };
}

// "Today" is the device's local calendar date.
export function localToday(now = new Date()): number {
  return dayOf(
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
  );
}

export function dateOfDay(day: number): Date {
  return new Date(day * millisecondsPerDay);
}

export function yearStart(year: number): number {
  return dayOf(new Date(Date.UTC(year, 0, 1)));
}

export function monthStart(year: number, monthIndex: number): number {
  return dayOf(new Date(Date.UTC(year, monthIndex, 1)));
}

// Running total of `metric` for each day from `first` through `last`.
export function cumulativeByDay(
  activities: readonly StatsActivity[],
  metric: StatsMetric,
  first: number,
  last: number,
): number[] {
  if (last < first) return [];
  const perDay = new Array<number>(last - first + 1).fill(0);
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day < first || day > last) continue;
    perDay[day - first]! += metricValue(activity, metric);
  }
  let total = 0;
  return perDay.map((value) => (total += value));
}

export type SportValues = Record<Sport, number>;

function emptySportValues(): SportValues {
  return { bcXcSki: 0, trailHike: 0, run: 0, ride: 0, misc: 0 };
}

export type WeekBySport = { weekStart: number; bySport: SportValues };

// The same weeks as tileData.weeklyVolume, split by sport.
export function weeklyVolumeBySport(
  activities: readonly StatsActivity[],
  today: number,
  metric: StatsMetric,
  weeks = 12,
): WeekBySport[] {
  const firstWeek = mondayOf(today) - (weeks - 1) * 7;
  const rows = Array.from({ length: weeks }, (_, index) => ({
    weekStart: firstWeek + index * 7,
    bySport: emptySportValues(),
  }));
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day < firstWeek || day > today) continue;
    const row = rows[Math.floor((day - firstWeek) / 7)]!;
    row.bySport[activity.sport] += metricValue(activity, metric);
  }
  return rows;
}

// Per-day sums for the calendar, one entry per active day.
export function dailyTotals(
  activities: readonly StatsActivity[],
  first: number,
  last: number,
): Map<number, Record<StatsMetric, number>> {
  const days = new Map<number, Record<StatsMetric, number>>();
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day < first || day > last) continue;
    const totals = days.get(day) ?? {
      count: 0,
      distance: 0,
      elevation: 0,
      time: 0,
    };
    totals.count += 1;
    totals.distance += metricValue(activity, 'distance');
    totals.elevation += metricValue(activity, 'elevation');
    totals.time += metricValue(activity, 'time');
    days.set(day, totals);
  }
  return days;
}

export type SportBreakdown = { sport: Sport } & Record<StatsMetric, number>;

export function sportBreakdown(
  activities: readonly StatsActivity[],
  first: number,
  last: number,
): SportBreakdown[] {
  const rows = new Map<Sport, SportBreakdown>(
    sportOrder.map((sport) => [
      sport,
      { sport, count: 0, distance: 0, elevation: 0, time: 0 },
    ]),
  );
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day < first || day > last) continue;
    const row = rows.get(activity.sport)!;
    row.count += 1;
    row.distance += metricValue(activity, 'distance');
    row.elevation += metricValue(activity, 'elevation');
    row.time += metricValue(activity, 'time');
  }
  return [...rows.values()].filter((row) => row.count > 0);
}

// Whether each of the last `days` days (oldest first, ending today) had an
// activity.
export function activeDayFlags(
  activities: readonly StatsActivity[],
  today: number,
  days: number,
): boolean[] {
  const first = today - days + 1;
  const flags = new Array<boolean>(days).fill(false);
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day >= first && day <= today) flags[day - first] = true;
  }
  return flags;
}

// A leap reference year keeps March–December aligned across every year.
export const comparisonYear = 2000;
export function cumulativeYearPoints(
  activities: readonly StatsActivity[],
  metric: StatsMetric,
  year: number,
  last: number,
): { x: number; y: number }[] {
  const first = yearStart(year);
  return cumulativeByDay(activities, metric, first, last).map((y, index) => {
    const date = dateOfDay(first + index);
    return {
      x:
        monthStart(comparisonYear, date.getUTCMonth()) +
        date.getUTCDate() -
        1 -
        yearStart(comparisonYear),
      y,
    };
  });
}

// A rolling year spans parts of thirteen calendar months, including both ends.
export function calendarMonths(today: number, first = sameDateLastYear(today)) {
  const date = dateOfDay(first);
  const end = dateOfDay(today);
  const count =
    (end.getUTCFullYear() - date.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    date.getUTCMonth() +
    1;
  return Array.from({ length: count }, (_, index) => {
    const start = monthStart(date.getUTCFullYear(), date.getUTCMonth() + index);
    const next = monthStart(
      date.getUTCFullYear(),
      date.getUTCMonth() + index + 1,
    );
    return {
      start,
      length: next - start,
      first: Math.max(first, start),
      last: Math.min(today, next - 1),
    };
  });
}

// Include the partial week as well as the trend in the visible domain.
export function volumeDomain(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * 0.25, high * 0.05, 1);
  return [Math.max(0, low - padding), Math.max(high + padding, 1)];
}
