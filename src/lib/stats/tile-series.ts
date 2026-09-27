// Chart series behind the stats tiles and their detail views. The headline
// numbers come from tile-data.ts, which the shared fixtures pin; these
// helpers only shape the same activities into points to draw, following the
// date rules in shared/stats-rules.md.

import { type StatsMetric } from '~/settings/stats-tiles.generated';
import { aliasMap } from '~/settings/category';
import { type Activity } from '~/server/db/schema';

import {
  dayOf,
  metricValue,
  mondayOf,
  sportOrder,
  type Sport,
  type StatsActivity,
} from './tile-data';

const millisecondsPerDay = 86_400_000;

export function toStatsActivity(activity: Activity): StatsActivity {
  return {
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
