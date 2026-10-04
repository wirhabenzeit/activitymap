import { type StatsMetric } from '~/settings/stats-tiles.generated';
import { dayOf, type StatsActivity } from './tile-data';
import {
  comparisonYear,
  cumulativeByDay,
  dateOfDay,
  monthStart,
  yearStart,
} from './tile-series';

export type ComparisonBand = {
  kind: 'month' | 'year';
  count: number;
  first: number;
  last: number;
  points: { x: number; low: number; high: number; count: number }[];
};

// Linear interpolation at (n - 1) * p, shared with the native engine.
function quantile(sorted: number[], p: number) {
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  return (
    sorted[lower]! +
    (sorted[Math.ceil(index)]! - sorted[lower]!) * (index - lower)
  );
}

export function comparisonBand(
  activities: readonly StatsActivity[],
  today: number,
  metric: StatsMetric,
  kind: 'month' | 'year',
): ComparisonBand | undefined {
  const earliest = activities.reduce(
    (first, activity) => Math.min(first, dayOf(activity.start_date_local)),
    Infinity,
  );
  if (!Number.isFinite(earliest) || earliest >= today) return;
  const startOf = (day: number) => {
    const date = dateOfDay(day);
    return kind === 'month'
      ? monthStart(date.getUTCFullYear(), date.getUTCMonth())
      : yearStart(date.getUTCFullYear());
  };
  const next = (day: number) => {
    const date = dateOfDay(day);
    return kind === 'month'
      ? monthStart(date.getUTCFullYear(), date.getUTCMonth() + 1)
      : yearStart(date.getUTCFullYear() + 1);
  };
  // Do not invent history before the first recording or include its partial opening period.
  const first =
    earliest === startOf(earliest) ? earliest : next(startOf(earliest));
  const end = startOf(today);
  if (first >= end) return;
  const cumulative = cumulativeByDay(activities, metric, first, end - 1);
  const samples = new Map<number, number[]>();
  let count = 0;
  for (let start = first; start < end; start = next(start)) {
    count++;
    const limit = next(start);
    const baseline = cumulative[start - first - 1] ?? 0;
    const add = (x: number, day: number) => {
      const values = samples.get(x) ?? [];
      values.push(day < start ? 0 : cumulative[day - first]! - baseline);
      samples.set(x, values);
    };
    if (kind === 'month') {
      add(0, start - 1);
      // Keep the same population through day 31: shorter months retain their final total.
      for (let x = 1; x <= 31; x++) add(x, Math.min(start + x - 1, limit - 1));
    } else {
      const year = dateOfDay(start).getUTCFullYear();
      for (let x = 0; x < 366; x++) {
        const date = dateOfDay(yearStart(comparisonYear) + x);
        const month = date.getUTCMonth();
        // Feb 29 uses Feb 28 in non-leap years, as in same-date comparisons.
        const day = Math.min(
          date.getUTCDate(),
          monthStart(year, month + 1) - monthStart(year, month),
        );
        add(x, monthStart(year, month) + day - 1);
      }
    }
  }
  if (count < 2) return;
  return {
    kind,
    count,
    first,
    last: end - 1,
    points: [...samples]
      .sort(([a], [b]) => a - b)
      .flatMap(([x, values]) => {
        if (values.length < 2) return [];
        values.sort((a, b) => a - b);
        return [
          {
            x,
            low: quantile(values, kind === 'month' ? 0.05 : 0),
            high: quantile(values, kind === 'month' ? 0.95 : 1),
            count: values.length,
          },
        ];
      }),
  };
}
