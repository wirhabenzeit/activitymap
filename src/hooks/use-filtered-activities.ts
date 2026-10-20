'use client';

import { useMemo } from 'react';

import type { Activity } from '~/lib/activity';
import { projectActivities } from '~/lib/browsing-projection';
import { useShallowStore } from '~/store';

/** Pure projection: no library observer and no selection writes. */
export function useFilteredActivities(activities: Activity[] | undefined) {
  const filterState = useShallowStore((state) => ({
    sportType: state.sportType,
    sportGroup: state.sportGroup,
    dateRange: state.dateRange,
    values: state.values,
    search: state.search,
    binary: state.binary,
  }));
  return useMemo(
    () => projectActivities(activities, filterState),
    [activities, filterState],
  );
}
