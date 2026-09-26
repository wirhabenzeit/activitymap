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

export type WeekActiveDays = { weekStart: number; activeDays: number };

export function activeDaysPerWeek(
  activities: readonly StatsActivity[],
  today: number,
  weeks: number,
): WeekActiveDays[] {
  const firstWeek = mondayOf(today) - (weeks - 1) * 7;
  const days = new Set<number>();
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day >= firstWeek && day <= today) days.add(day);
  }
  const rows = Array.from({ length: weeks }, (_, index) => ({
    weekStart: firstWeek + index * 7,
    activeDays: 0,
  }));
  for (const day of days) rows[Math.floor((day - firstWeek) / 7)]!.activeDays++;
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

export type YearBySport = { year: number; bySport: SportValues };

// Every calendar year from the first activity through today's year; the
// current year stops at today.
export function totalsByYear(
  activities: readonly StatsActivity[],
  today: number,
  metric: StatsMetric,
): YearBySport[] {
  const lastYear = dateOfDay(today).getUTCFullYear();
  let firstYear = lastYear;
  for (const activity of activities) {
    if (dayOf(activity.start_date_local) > today) continue;
    firstYear = Math.min(firstYear, activity.start_date_local.getUTCFullYear());
  }
  const rows = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => ({
    year: firstYear + index,
    bySport: emptySportValues(),
  }));
  for (const activity of activities) {
    if (dayOf(activity.start_date_local) > today) continue;
    const row = rows[activity.start_date_local.getUTCFullYear() - firstYear]!;
    row.bySport[activity.sport] += metricValue(activity, metric);
  }
  return rows;
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

// Per-day sums of `metric` for the current week, Monday first. Days after
// today are null.
export function thisWeekByDay(
  activities: readonly StatsActivity[],
  today: number,
  metric: StatsMetric,
): (number | null)[] {
  const monday = mondayOf(today);
  const days = Array.from({ length: 7 }, (_, index) =>
    monday + index <= today ? 0 : null,
  );
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day < monday || day > today) continue;
    days[day - monday]! += metricValue(activity, metric);
  }
  return days;
}

export type TypicalWeek = Record<StatsMetric, number> & { activeDays: number };

// Means per full week over the `weeks - 1` full weeks before the current,
// partial one (the same weeks as consistency's activeDaysPerWeek).
export function typicalWeek(
  activities: readonly StatsActivity[],
  today: number,
  weeks = 12,
): TypicalWeek {
  const currentWeek = mondayOf(today);
  const first = currentWeek - (weeks - 1) * 7;
  const sums = { count: 0, distance: 0, elevation: 0, time: 0 };
  const activeDays = new Set<number>();
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day < first || day >= currentWeek) continue;
    activeDays.add(day);
    for (const metric of Object.keys(sums) as StatsMetric[])
      sums[metric] += metricValue(activity, metric);
  }
  const fullWeeks = weeks - 1;
  return {
    count: sums.count / fullWeeks,
    distance: sums.distance / fullWeeks,
    elevation: sums.elevation / fullWeeks,
    time: sums.time / fullWeeks,
    activeDays: activeDays.size / fullWeeks,
  };
}

// The longest run of consecutive active days up to today.
export function longestStreak(
  activities: readonly StatsActivity[],
  today: number,
): number {
  const days = [
    ...new Set(
      activities
        .map((activity) => dayOf(activity.start_date_local))
        .filter((day) => day <= today),
    ),
  ].sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  days.forEach((day, index) => {
    current = index > 0 && days[index - 1] === day - 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  });
  return longest;
}

// Where this year's pace lands by 31 December, next to last year's total.
export function yearPace(
  activities: readonly StatsActivity[],
  today: number,
  metric: StatsMetric,
) {
  const year = dateOfDay(today).getUTCFullYear();
  const first = yearStart(year);
  const daysSoFar = today - first + 1;
  const daysInYear = yearStart(year + 1) - first;
  let current = 0;
  let lastYear = 0;
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day >= first && day <= today) current += metricValue(activity, metric);
    else if (day >= yearStart(year - 1) && day < first)
      lastYear += metricValue(activity, metric);
  }
  const perDay = current / daysSoFar;
  return { current, perDay, projected: perDay * daysInYear, lastYear };
}

export const climbingBands = [
  { id: 'flat', label: 'Flat', below: 8 },
  { id: 'rolling', label: 'Rolling', below: 15 },
  { id: 'hilly', label: 'Hilly', below: 30 },
  { id: 'mountainous', label: 'Mountainous', below: Infinity },
] as const;

// Activities of at least 1 km from `first` through `today`, counted by climb
// rate (metres of elevation gain per km).
export function climbingDistribution(
  activities: readonly StatsActivity[],
  first: number,
  today: number,
) {
  const counts = climbingBands.map((band) => ({ ...band, count: 0 }));
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    const distance = metricValue(activity, 'distance');
    if (day < first || day > today || distance < 1) continue;
    const rate = metricValue(activity, 'elevation') / distance;
    counts.find((band) => rate < band.below)!.count += 1;
  }
  return counts;
}

export type ActivityRecord = { value: number; day: number; sport: Sport };

// The single activities (and the week) with the most distance, time and
// elevation from `first` through `today`.
export function records(
  activities: readonly StatsActivity[],
  first: number,
  today: number,
) {
  const best: Partial<Record<StatsMetric, ActivityRecord>> = {};
  const weeks = new Map<number, number>();
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day < first || day > today) continue;
    for (const metric of ['distance', 'time', 'elevation'] as const) {
      const value = metricValue(activity, metric);
      if (value > (best[metric]?.value ?? 0))
        best[metric] = { value, day, sport: activity.sport };
    }
    const week = mondayOf(day);
    weeks.set(week, (weeks.get(week) ?? 0) + metricValue(activity, 'distance'));
  }
  let biggestWeek: { value: number; weekStart: number } | undefined;
  for (const [weekStart, value] of weeks)
    if (value > (biggestWeek?.value ?? 0)) biggestWeek = { value, weekStart };
  return { ...best, biggestWeek };
}
