'use client';
import { useMemo } from 'react';
import { useShallowStore } from '~/store';
import { browsingIDs } from '~/lib/activity-selection';
/** A projection only: ordinary filter reconciliation must never consume this. */
export function useBrowsingIDs(eligibleIDs: number[]) {
  const { selectedIDs, onlySelected } = useShallowStore((s) => ({
    selectedIDs: s.selected,
    onlySelected: s.onlySelected,
  }));
  return useMemo(
    () => browsingIDs({ selectedIDs, onlySelected }, eligibleIDs),
    [selectedIDs, onlySelected, eligibleIDs],
  );
}
