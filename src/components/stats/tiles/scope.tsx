'use client';

import { useMemo } from 'react';
import { Filter } from 'lucide-react';
import { useActivities } from '~/hooks/use-activities';
import { useShallowStore } from '~/store';
import {
  initializeBinary,
  initializeSportType,
  initializeValues,
} from '~/store/filter';
import {
  filterStatsActivities,
  statsFilterScope,
} from '~/lib/stats/filter-scope';
import { toStatsActivity } from '~/lib/stats/tile-series';

export function useStatsActivities() {
  const query = useActivities();
  const state = useShallowStore((s) => ({
    sportType: s.sportType,
    sportGroup: s.sportGroup,
    dateRange: s.dateRange,
    values: s.values,
    binary: s.binary,
    search: s.search,
  }));
  const reset = useShallowStore((s) => ({
    setSportType: s.setSportType,
    setValues: s.setValues,
    setBinary: s.setBinary,
    setSearch: s.setSearch,
  }));
  const activities = useMemo(
    () => filterStatsActivities(query.data ?? [], state).map(toStatsActivity),
    [query.data, state],
  );
  return {
    query,
    activities,
    scope: statsFilterScope(state),
    reset: () => {
      reset.setSportType(initializeSportType());
      reset.setValues(initializeValues());
      reset.setBinary(initializeBinary());
      reset.setSearch('');
    },
  };
}

export function FilterScope({
  labels,
  onReset,
}: {
  labels: string[];
  onReset: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
      <div
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
        aria-label="Stats activity filters"
      >
        <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {labels.length ? (
          labels.map((label) => (
            <span
              key={label}
              className="max-w-full break-words rounded bg-muted px-2 py-1"
            >
              {label}
            </span>
          ))
        ) : (
          <span>All activities</span>
        )}
      </div>
      {labels.length > 0 && (
        <button
          type="button"
          className="min-h-8 underline underline-offset-2"
          onClick={onReset}
        >
          Clear activity filters
        </button>
      )}
      <p className="w-full">
        Each card uses its own period. Activity filters also apply to
        comparisons.
      </p>
    </div>
  );
}
