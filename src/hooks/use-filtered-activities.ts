'use client';

import { useMemo } from 'react';

import type { Activity } from '~/lib/activity';
import { projectActivities } from '~/lib/browsing-projection';

import { useDeferredActivityFilters } from './use-deferred-activity-filters';

/** Pure projection: no library observer and no selection writes. */
export function useFilteredActivities(activities: Activity[] | undefined) {
  const filterState = useDeferredActivityFilters();
  return useMemo(
    () => projectActivities(activities, filterState),
    [activities, filterState],
  );
}
