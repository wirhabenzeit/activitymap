'use client';

import { type ReactNode, createContext, useContext, useMemo } from 'react';

import { useActivities } from './use-activities';
import { useFilteredActivities } from './use-filtered-activities';
import { useSelectionReconciliation } from './use-selection-reconciliation';

function useLibraryProjection() {
  const query = useActivities();
  const projection = useFilteredActivities(query.data);
  const byID = useMemo(
    () => new Map(query.data?.map((activity) => [activity.id, activity])),
    [query.data],
  );
  useSelectionReconciliation(
    query.data,
    !query.hasNextPage,
    projection.filterIDs,
  );
  return useMemo(
    () => ({ query, ...projection, byID }),
    [query, projection, byID],
  );
}
const BrowsingContext = createContext<ReturnType<
  typeof useLibraryProjection
> | null>(null);

export function BrowsingProvider({ children }: { children: ReactNode }) {
  const value = useLibraryProjection();
  return <BrowsingContext value={value}>{children}</BrowsingContext>;
}

export function useBrowsingLibrary() {
  const value = useContext(BrowsingContext);
  if (!value) throw new Error('Browsing consumers require BrowsingProvider');
  return value;
}
