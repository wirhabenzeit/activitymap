'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

import { filterStatsActivities } from '~/lib/stats/filter-scope';
import { isStatsRoute } from '~/lib/stats/route';
import { useShallowStore } from '~/store';
import { activeFilterCount } from '~/store/filter';

import { useBrowsingIDs } from './use-browsing-activities';
import { useBrowsingLibrary } from './use-browsing-library';
import { useDeferredActivityFilters } from './use-deferred-activity-filters';

/** Restrictions in force for the current page: stats ignore the reporting
 * period and "only selected", so those never inflate its count. */
export function useActiveFilterCount() {
  const scope = isStatsRoute(usePathname()) ? 'stats' : 'browse';
  return useShallowStore((state) => activeFilterCount(state, scope));
}

/** "N of M activities": what the current page shows out of the whole library.
 * Undefined until the library has loaded. */
export function useFilterResultCount() {
  const stats = isStatsRoute(usePathname());
  const { query, filterIDs } = useBrowsingLibrary();
  const browsing = useBrowsingIDs(filterIDs);
  const filters = useDeferredActivityFilters();
  const data = query.data;
  const statsShown = useMemo(
    () =>
      stats && data ? filterStatsActivities(data, filters).length : undefined,
    [stats, data, filters],
  );
  if (!data) return undefined;
  return { shown: statsShown ?? browsing.length, total: data.length };
}
