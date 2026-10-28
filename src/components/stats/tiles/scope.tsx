'use client';

import { Filter } from 'lucide-react';
import { useMemo } from 'react';

import { useBrowsingLibrary } from '~/hooks/use-browsing-library';
import { useDeferredActivityFilters } from '~/hooks/use-deferred-activity-filters';
import {
  filterStatsActivities,
  statsFilterScope,
} from '~/lib/stats/filter-scope';
import { toStatsActivity } from '~/lib/stats/tile-series';
import { useShallowStore } from '~/store';

export function useStatsActivities() {
  const { query } = useBrowsingLibrary();
  const state = useDeferredActivityFilters();
  const reset = useShallowStore((s) => s.resetActivityFilters);
  // The full activities keep their synced place bundles for place rankings.
  const placeActivities = useMemo(
    () => filterStatsActivities(query.data ?? [], state),
    [query.data, state],
  );
  const activities = useMemo(
    () => placeActivities.map(toStatsActivity),
    [placeActivities],
  );
  return {
    query,
    activities,
    placeActivities,
    scope: statsFilterScope(state),
    reset,
  };
}

export function FilterScope({
  labels,
  onReset,
}: {
  labels: string[];
  onReset: () => void;
}) {
  if (labels.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
      <div
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
        aria-label="Stats activity filters"
      >
        <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {labels.map((label) => (
          <span
            key={label}
            className="max-w-full rounded bg-muted px-2 py-1 break-words"
          >
            {label}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="min-h-8 underline underline-offset-2"
        onClick={onReset}
      >
        Clear activity filters
      </button>
    </div>
  );
}
