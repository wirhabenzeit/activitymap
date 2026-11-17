'use client';

import { useMemo } from 'react';

import { useBrowsingLibrary } from '~/hooks/use-browsing-library';
import { toStatsActivity } from '~/lib/stats/tile-series';
import { useShallowStore } from '~/store';
import { filterByStatsSports } from '~/store/stats-scope';

export function useStatsActivities() {
  const { query } = useBrowsingLibrary();
  const sports = useShallowStore((s) => s.statsSports);
  const activities = useMemo(
    () => filterByStatsSports(query.data ?? [], sports).map(toStatsActivity),
    [query.data, sports],
  );
  return {
    query,
    activities,
    singleSport: Object.values(sports).filter(Boolean).length === 1,
  };
}
