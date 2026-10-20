'use client';

import { useEffect, useMemo } from 'react';

import type { Activity } from '~/lib/activity';
import { committedSelectionIDs } from '~/lib/browsing-projection';
import { store } from '~/store';

/** Mount exactly once at the browsing library boundary, never in a leaf
 * projection. A partial snapshot cannot prove a selected identity was deleted. */
export function useSelectionReconciliation(
  activities: Activity[] | undefined,
  complete: boolean,
  eligibleIDs: number[],
) {
  const knownIDs = useMemo(
    () => committedSelectionIDs(activities, complete),
    [activities, complete],
  );
  useEffect(() => {
    if (activities !== undefined)
      store.getState().reconcileSelection(knownIDs, eligibleIDs);
  }, [activities, knownIDs, eligibleIDs]);
}
