import type { StatsMetric } from '~/settings/stats-tiles.generated';

import { type StatsActivity, yearPace } from './tile-data';

/** Screen-lifetime pure memo. It owns no library data, queries or subscriptions. */
export function createStatsTileModels(
  activities: readonly StatsActivity[],
  today: number,
  derive = yearPace,
) {
  const pace = new Map<StatsMetric, ReturnType<typeof yearPace>>();
  return {
    yearPace(metric: StatsMetric) {
      let result = pace.get(metric);
      if (!result) {
        result = derive(activities, today, metric);
        pace.set(metric, result);
      }
      return result;
    },
  };
}
export type StatsTileModels = ReturnType<typeof createStatsTileModels>;
