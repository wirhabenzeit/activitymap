'use client';

import { usePathname } from 'next/navigation';

import { workspaceFor } from '~/lib/workspace';
import { useShallowStore } from '~/store';
import { activeFilterCount } from '~/store/filter';

import { useBrowsingIDs } from './use-browsing-activities';
import { useOptionalBrowsingLibrary } from './use-browsing-library';

const emptyIDs: number[] = [];

/** Each workspace counts only its own restrictions. */
export function useActiveFilterCount() {
  const stats = workspaceFor(usePathname()) === 'stats';
  return useShallowStore((state) =>
    stats
      ? Object.values(state.statsSports).every(Boolean)
        ? 0
        : 1
      : activeFilterCount(state),
  );
}

/** Stats counts sports; activities counts matching rows after loading. */
export function useFilterResultCount() {
  const stats = workspaceFor(usePathname()) === 'stats';
  const library = useOptionalBrowsingLibrary();
  const browsing = useBrowsingIDs(library?.filterIDs ?? emptyIDs);
  const sports = useShallowStore((state) => state.statsSports);
  const data = library?.query.data;
  if (stats)
    return {
      shown: Object.values(sports).filter(Boolean).length,
      total: Object.keys(sports).length,
      unit: 'sports',
    };
  if (!data) return undefined;
  return { shown: browsing.length, total: data.length, unit: 'activities' };
}
