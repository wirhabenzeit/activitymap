// Numbers behind the stats tiles. shared/stats-rules.md defines every rule
// here, and shared/stats-fixtures holds the numbers the web and iOS
// implementations must both produce.

import { type StatsMetric } from '~/settings/stats-tiles.generated';

export type Sport = 'bcXcSki' | 'trailHike' | 'run' | 'ride' | 'misc';

export const sportOrder: readonly Sport[] = [
  'bcXcSki',
  'trailHike',
  'run',
  'ride',
  'misc',
];

export type StatsActivity = {
  sport: Sport;
  // Wall-clock start time, encoded as if it were UTC.
  start_date_local: Date;
  distance: number | null;
  moving_time: number | null;
  total_elevation_gain: number | null;
};

// A calendar day, counted from 1970-01-01.
type Day = number;

const millisecondsPerDay = 86_400_000;

export function dayOf(date: Date): Day {
  return Math.floor(date.getTime() / millisecondsPerDay);
}

export function dayFromISODate(isoDate: string): Day {
  return dayOf(new Date(`${isoDate}T00:00:00Z`));
}

export function isoDate(day: Day): string {
  return new Date(day * millisecondsPerDay).toISOString().slice(0, 10);
}

function dayFromParts(year: number, monthIndex: number, date: number): Day {
  return dayOf(new Date(Date.UTC(year, monthIndex, date)));
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// The same calendar date one year earlier, with 29 February clamped to 28.
function sameDateLastYear(day: Day): Day {
  const date = new Date(day * millisecondsPerDay);
  const year = date.getUTCFullYear() - 1;
  const month = date.getUTCMonth();
  return dayFromParts(
    year,
    month,
    Math.min(date.getUTCDate(), daysInMonth(year, month)),
  );
}

export function mondayOf(day: Day): Day {
  // 1970-01-01 was a Thursday.
  return day - ((day + 3) % 7);
}

export function metricValue(
  activity: StatsActivity,
  metric: StatsMetric,
): number {
  switch (metric) {
    case 'count':
      return 1;
    case 'distance':
      return (activity.distance ?? 0) / 1000;
    case 'elevation':
      return activity.total_elevation_gain ?? 0;
    case 'time':
      return (activity.moving_time ?? 0) / 3600;
  }
}

function sumBetween(
  activities: readonly StatsActivity[],
  metric: StatsMetric,
  first: Day,
  last: Day,
): number {
  let total = 0;
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day >= first && day <= last) total += metricValue(activity, metric);
  }
  return total;
}

export type Comparison = { current: number; previous: number };

export function yearToDate(
  activities: readonly StatsActivity[],
  today: Day,
  metric: StatsMetric,
): Comparison {
  const date = new Date(today * millisecondsPerDay);
  const year = date.getUTCFullYear();
  const previousEnd = sameDateLastYear(today);
  return {
    current: sumBetween(activities, metric, dayFromParts(year, 0, 1), today),
    previous: sumBetween(
      activities,
      metric,
      dayFromParts(year - 1, 0, 1),
      previousEnd,
    ),
  };
}

export function totals(
  activities: readonly StatsActivity[],
  today: Day,
): Record<StatsMetric, number> {
  const start = dayFromParts(
    new Date(today * millisecondsPerDay).getUTCFullYear(),
    0,
    1,
  );
  return {
    count: sumBetween(activities, 'count', start, today),
    distance: sumBetween(activities, 'distance', start, today),
    elevation: sumBetween(activities, 'elevation', start, today),
    time: sumBetween(activities, 'time', start, today),
  };
}

export type WeeklyVolume = { weekStarts: Day[]; values: number[] };

export function weeklyVolume(
  activities: readonly StatsActivity[],
  today: Day,
  metric: StatsMetric,
  weeks = 12,
): WeeklyVolume {
  const firstWeek = mondayOf(today) - (weeks - 1) * 7;
  const weekStarts = Array.from(
    { length: weeks },
    (_, index) => firstWeek + index * 7,
  );
  return {
    weekStarts,
    values: weekStarts.map((start) =>
      sumBetween(activities, metric, start, Math.min(start + 6, today)),
    ),
  };
}

export type ActivityCalendar = {
  activeDays: number;
  dominantSport: Map<Day, Sport>;
};

export function activityCalendar(
  activities: readonly StatsActivity[],
  today: Day,
): ActivityCalendar {
  const first = sameDateLastYear(today);
  const timeByDay = new Map<Day, Map<Sport, number>>();
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day < first || day > today) continue;
    const bySport = timeByDay.get(day) ?? new Map<Sport, number>();
    bySport.set(
      activity.sport,
      (bySport.get(activity.sport) ?? 0) + metricValue(activity, 'time'),
    );
    timeByDay.set(day, bySport);
  }

  const dominantSport = new Map<Day, Sport>();
  for (const [day, bySport] of timeByDay) {
    let best: Sport | undefined;
    for (const sport of sportOrder) {
      const time = bySport.get(sport);
      if (time === undefined) continue;
      if (best === undefined || time > (bySport.get(best) ?? 0)) best = sport;
    }
    if (best) dominantSport.set(day, best);
  }
  return { activeDays: timeByDay.size, dominantSport };
}

export function monthVsLastMonth(
  activities: readonly StatsActivity[],
  today: Day,
  metric: StatsMetric,
): Comparison {
  const date = new Date(today * millisecondsPerDay);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const previousMonthStart = new Date(Date.UTC(year, month - 1, 1));
  const previousYear = previousMonthStart.getUTCFullYear();
  const previousMonth = previousMonthStart.getUTCMonth();
  const previousEnd = dayFromParts(
    previousYear,
    previousMonth,
    Math.min(date.getUTCDate(), daysInMonth(previousYear, previousMonth)),
  );
  return {
    current: sumBetween(
      activities,
      metric,
      dayFromParts(year, month, 1),
      today,
    ),
    previous: sumBetween(
      activities,
      metric,
      dayOf(previousMonthStart),
      previousEnd,
    ),
  };
}

export type SportShare = { sport: Sport; share: number };

export function sportMix(
  activities: readonly StatsActivity[],
  today: Day,
  range: 'currentYear' | 'allTime',
): SportShare[] {
  const first =
    range === 'allTime'
      ? -Infinity
      : dayFromParts(
          new Date(today * millisecondsPerDay).getUTCFullYear(),
          0,
          1,
        );
  const timeBySport = new Map<Sport, number>();
  let total = 0;
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day < first || day > today) continue;
    const time = metricValue(activity, 'time');
    timeBySport.set(
      activity.sport,
      (timeBySport.get(activity.sport) ?? 0) + time,
    );
    total += time;
  }
  if (total === 0) return [];
  return sportOrder
    .map((sport) => ({ sport, share: (timeBySport.get(sport) ?? 0) / total }))
    .filter(({ share }) => share > 0)
    .sort((a, b) => b.share - a.share);
}

export type Consistency = { activeDaysPerWeek: number; currentStreak: number };

export function consistency(
  activities: readonly StatsActivity[],
  today: Day,
  weeks: 12 | 52 = 12,
): Consistency {
  const activeDays = new Set<Day>();
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day <= today) activeDays.add(day);
  }

  const currentWeek = mondayOf(today);
  const firstFullWeek = currentWeek - (weeks - 1) * 7;
  let daysInFullWeeks = 0;
  for (const day of activeDays) {
    if (day >= firstFullWeek && day < currentWeek) daysInFullWeeks += 1;
  }

  let streakDay = activeDays.has(today) ? today : today - 1;
  let currentStreak = 0;
  while (activeDays.has(streakDay)) {
    currentStreak += 1;
    streakDay -= 1;
  }

  return {
    activeDaysPerWeek: daysInFullWeeks / (weeks - 1),
    currentStreak,
  };
}

export type DistanceVsElevation = {
  points: { distance: number; elevation: number; sport: Sport }[];
  metersPerKm: number;
};

export function distanceVsElevation(
  activities: readonly StatsActivity[],
  today: Day,
): DistanceVsElevation {
  const first = sameDateLastYear(today);
  const points: DistanceVsElevation['points'] = [];
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    const distance = metricValue(activity, 'distance');
    if (day < first || day > today || distance <= 0) continue;
    points.push({
      distance,
      elevation: metricValue(activity, 'elevation'),
      sport: activity.sport,
    });
  }
  const totalDistance = points.reduce((sum, point) => sum + point.distance, 0);
  const totalElevation = points.reduce(
    (sum, point) => sum + point.elevation,
    0,
  );
  return {
    points,
    metersPerKm: totalDistance > 0 ? totalElevation / totalDistance : 0,
  };
}
