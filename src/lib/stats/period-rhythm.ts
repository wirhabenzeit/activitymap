import {
  compareStatsActivities,
  dayOf,
  metricValue,
  sameDateLastYear,
  sportOrder,
  type Sport,
  type StatsActivity,
} from './tile-data';
import { dateOfDay, monthStart } from './tile-series';
import { type StatsMetric } from '~/settings/stats-tiles.generated';

export type PeriodSportValues = Record<Sport, number>;
const emptyValues = (): PeriodSportValues =>
  Object.fromEntries(
    sportOrder.map((sport) => [sport, 0]),
  ) as PeriodSportValues;
export const periodTotal = (values: PeriodSportValues) =>
  sportOrder.reduce((sum, sport) => sum + values[sport], 0);

export function monthActivityRhythm(
  activities: readonly StatsActivity[],
  today: number,
  metric: StatsMetric,
) {
  const date = dateOfDay(today);
  const first = monthStart(date.getUTCFullYear(), date.getUTCMonth());
  const last = monthStart(date.getUTCFullYear(), date.getUTCMonth() + 1) - 1;
  const days = Array.from({ length: last - first + 1 }, (_, index) => ({
    day: first + index,
    activities: [] as StatsActivity[],
    bySport: emptyValues(),
  }));
  let activityCount = 0;
  let measuredCount = 0;
  let total = 0;
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    if (day < first || day > today) continue;
    const row = days[day - first]!;
    row.activities.push(activity);
    const value = metricValue(activity, metric);
    row.bySport[activity.sport] += value;
    total += value;
    activityCount++;
    const measured =
      metric === 'count' ||
      (metric === 'distance'
        ? activity.distance !== null
        : metric === 'time'
          ? activity.moving_time !== null
          : activity.total_elevation_gain !== null);
    if (measured) measuredCount++;
  }
  for (const day of days) day.activities.sort(compareStatsActivities);
  const activeDays = days.filter((day) => day.activities.length > 0).length;
  return {
    days,
    activityCount,
    activeDays,
    measuredCount,
    average:
      metric === 'count'
        ? activeDays > 0
          ? activityCount / activeDays
          : null
        : measuredCount > 0
          ? total / measuredCount
          : null,
  };
}

/** Compare completed months and the same calendar date in the current month. */
export function yearMonthlyRhythm(
  activities: readonly StatsActivity[],
  today: number,
  metric: StatsMetric,
) {
  const date = dateOfDay(today);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const previousThrough = sameDateLastYear(today);
  const months = Array.from({ length: month + 1 }, (_, index) => ({
    start: monthStart(year, index),
    current: emptyValues(),
    previous: emptyValues(),
    inProgress: index === month,
  }));
  for (const activity of activities) {
    const day = dayOf(activity.start_date_local);
    const activityDate = dateOfDay(day);
    const activityYear = activityDate.getUTCFullYear();
    const activityMonth = activityDate.getUTCMonth();
    if (activityMonth > month) continue;
    const period =
      activityYear === year && day <= today
        ? 'current'
        : activityYear === year - 1 && day <= previousThrough
          ? 'previous'
          : null;
    if (period) {
      months[activityMonth]![period][activity.sport] += metricValue(
        activity,
        metric,
      );
    }
  }
  return months;
}
