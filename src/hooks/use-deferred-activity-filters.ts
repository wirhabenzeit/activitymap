'use client';

import { useDeferredValue, useMemo } from 'react';

import { useShallowStore } from '~/store';

/** Keep the controlled input urgent, but let expensive result consumers render
 * the latest search in an interruptible background pass. Other filters and
 * clearing search still take effect immediately. */
export function useDeferredActivityFilters() {
  const filters = useShallowStore((state) => ({
    sportType: state.sportType,
    sportGroup: state.sportGroup,
    dateRange: state.dateRange,
    values: state.values,
    place: state.place,
    binary: state.binary,
  }));
  const search = useShallowStore((state) => state.search);
  const deferredSearch = useDeferredValue(search);
  const appliedSearch = search === '' ? '' : deferredSearch;
  return useMemo(
    () => ({ ...filters, search: appliedSearch }),
    [filters, appliedSearch],
  );
}
