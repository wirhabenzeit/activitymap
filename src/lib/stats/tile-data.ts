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

export type Consistency = {
  activeDaysPerWeek: number;
  currentStreak: number;
  // Full weeks with at least five active days.
  solidWeeks: number;
};

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
  const daysPerWeek = new Map<Day, number>();
  for (const day of activeDays) {
    if (day >= firstFullWeek && day < currentWeek) {
      daysInFullWeeks += 1;
      daysPerWeek.set(mondayOf(day), (daysPerWeek.get(mondayOf(day)) ?? 0) + 1);
    }
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
    solidWeeks: [...daysPerWeek.values()].filter((days) => days >= 5).length,
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

// The tiles below came from the web prototype. Their rules are in
// shared/stats-rules.md like the ones above.

function activeDaySet(activities: readonly StatsActivity[]): Set<Day> {
  return new Set(
    activities.map((activity) => dayOf(activity.start_date_local)),
  );
}

// The metric over the last 28 days (today included) and the 28 before.
export function fourWeekVolume(
  activities: readonly StatsActivity[],
  today: Day,
  metric: StatsMetric,
): Comparison {
  return {
    current: sumBetween(activities, metric, today - 27, today),
    previous: sumBetween(activities, metric, today - 55, today - 28),
  };
}

export type ThisWeek = {
  // Monday first; days after today are null.
  days: (number | null)[];
  current: number;
  // The mean total from Monday through today's weekday over the 11 full
  // weeks before this one.
  typical: number;
};

export function thisWeek(
  activities: readonly StatsActivity[],
  today: Day,
  metric: StatsMetric,
): ThisWeek {
  const monday = mondayOf(today);
  const weekday = today - monday;
  const days = Array.from({ length: 7 }, (_, index) =>
    index <= weekday ? 0 : null,
  );
  let typicalTotal = 0;
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    const value = metricValue(activity, metric);
    if (day >= monday && day <= today) days[day - monday]! += value;
    else if (
      day >= monday - 77 &&
      day < monday &&
      day - mondayOf(day) <= weekday
    )
      typicalTotal += value;
  }
  return {
    days,
    current: days.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    typical: typicalTotal / 11,
  };
}

export type TypicalWeek = Record<StatsMetric, number> & { activeDays: number };

// Means per full week over the 11 full weeks before the current one.
export function typicalWeek(
  activities: readonly StatsActivity[],
  today: Day,
): TypicalWeek {
  const currentWeek = mondayOf(today);
  const first = currentWeek - 77;
  const inWindow = activities.filter((activity) => {
    const day = dayOf(activity.start_date_local);
    return day >= first && day < currentWeek;
  });
  const mean = (metric: StatsMetric) =>
    sumBetween(inWindow, metric, first, currentWeek - 1) / 11;
  return {
    count: mean('count'),
    distance: mean('distance'),
    elevation: mean('elevation'),
    time: mean('time'),
    activeDays: activeDaySet(inWindow).size / 11,
  };
}

export type YearPace = {
  current: number;
  perDay: number;
  // perDay times the number of days in this year.
  projected: number;
  // The whole previous calendar year.
  lastYear: number;
};

export function yearPace(
  activities: readonly StatsActivity[],
  today: Day,
  metric: StatsMetric,
): YearPace {
  const year = new Date(today * millisecondsPerDay).getUTCFullYear();
  const first = dayFromParts(year, 0, 1);
  const current = sumBetween(activities, metric, first, today);
  const perDay = current / (today - first + 1);
  return {
    current,
    perDay,
    projected: perDay * (dayFromParts(year + 1, 0, 1) - first),
    lastYear: sumBetween(
      activities,
      metric,
      dayFromParts(year - 1, 0, 1),
      first - 1,
    ),
  };
}

export type ActivityRecord = { value: number; day: Day; sport: Sport };
export type Records = {
  distance?: ActivityRecord;
  time?: ActivityRecord;
  elevation?: ActivityRecord;
  // The Monday-to-Sunday week with the most distance.
  biggestWeek?: { value: number; weekStart: Day };
};

// The single activities with the most distance, time and elevation over
// `currentYear` or `allTime`. Ties go to the earlier one.
export function records(
  activities: readonly StatsActivity[],
  today: Day,
  range: 'currentYear' | 'allTime',
): Records {
  const first =
    range === 'allTime'
      ? -Infinity
      : dayFromParts(
          new Date(today * millisecondsPerDay).getUTCFullYear(),
          0,
          1,
        );
  const inRange = activities
    .filter((activity) => {
      const day = dayOf(activity.start_date_local);
      return day >= first && day <= today;
    })
    .sort(
      (a, b) => a.start_date_local.getTime() - b.start_date_local.getTime(),
    );
  const best: Records = {};
  const weeks = new Map<Day, number>();
  for (const activity of inRange) {
    const day = dayOf(activity.start_date_local);
    for (const metric of ['distance', 'time', 'elevation'] as const) {
      const value = metricValue(activity, metric);
      if (value > (best[metric]?.value ?? 0))
        best[metric] = { value, day, sport: activity.sport };
    }
    const week = mondayOf(day);
    weeks.set(week, (weeks.get(week) ?? 0) + metricValue(activity, 'distance'));
  }
  for (const [weekStart, value] of [...weeks].sort(([a], [b]) => a - b))
    if (value > (best.biggestWeek?.value ?? 0))
      best.biggestWeek = { value, weekStart };
  return best;
}

export type BestDays = { total: number; start: Day; end: Day; current: number };

// The 30-day window this year (starting on or after 1 January, ending by
// today) with the largest total, the earliest on a tie, and the 30 days
// ending today. Before 30 January the only window is 1 January to today.
export function best30Days(
  activities: readonly StatsActivity[],
  today: Day,
  metric: StatsMetric,
): BestDays {
  const first = dayFromParts(
    new Date(today * millisecondsPerDay).getUTCFullYear(),
    0,
    1,
  );
  let best = {
    total: sumBetween(activities, metric, first, Math.min(today, first + 29)),
    start: first,
    end: Math.min(today, first + 29),
  };
  for (let start = first + 1; start + 29 <= today; start++) {
    const total = sumBetween(activities, metric, start, start + 29);
    if (total > best.total) best = { total, start, end: start + 29 };
  }
  return {
    ...best,
    current: sumBetween(activities, metric, today - 29, today),
  };
}

// Days without an activity among the last 30 and the last 90 days.
export function restDays(
  activities: readonly StatsActivity[],
  today: Day,
): { last30: number; last90: number } {
  const active = activeDaySet(activities);
  const rest = (days: number) =>
    Array.from({ length: days }, (_, index) => today - index).filter(
      (day) => !active.has(day),
    ).length;
  return { last30: rest(30), last90: rest(90) };
}

// Metres climbed per 100 km over activities with a distance above 0.
function climbRate(
  activities: readonly StatsActivity[],
  first: Day,
  last: Day,
): number {
  let distance = 0;
  let elevation = 0;
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    const km = metricValue(activity, 'distance');
    if (day < first || day > last || km <= 0) continue;
    distance += km;
    elevation += metricValue(activity, 'elevation');
  }
  return distance > 0 ? (elevation / distance) * 100 : 0;
}

export type Climbing = {
  // Metres per 100 km over last12Months, and over the 12 months before.
  current: number;
  previous: number;
  // The 11 calendar months before this one and this one through today.
  months: { monthStart: Day; rate: number }[];
};

export function climbing(
  activities: readonly StatsActivity[],
  today: Day,
): Climbing {
  const first = sameDateLastYear(today);
  const date = new Date(today * millisecondsPerDay);
  return {
    current: climbRate(activities, first, today),
    previous: climbRate(activities, sameDateLastYear(first), first - 1),
    months: Array.from({ length: 12 }, (_, index) => {
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth() - 11 + index;
      const monthStart = dayFromParts(year, month, 1);
      return {
        monthStart,
        rate: climbRate(
          activities,
          monthStart,
          Math.min(today, dayFromParts(year, month + 1, 1) - 1),
        ),
      };
    }),
  };
}
