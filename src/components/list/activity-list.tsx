'use client';

import { ListFilter } from 'lucide-react';
import React from 'react';
import { useShallow } from 'zustand/shallow';

import { ActivityCardContent } from '~/components/list/card';
import { activityColumns } from '~/components/list/columns';
import { DataTable } from '~/components/list/data-table';
import { SelectionShareButton } from '~/components/share-button';
import { useBrowsingIDs } from '~/hooks/use-browsing-activities';
import { useListInspection } from '~/hooks/use-list-inspection';
import { useShowOnMap } from '~/hooks/use-show-on-map';
import type { Activity } from '~/lib/activity';
import { applyTextFilter } from '~/lib/header-search';
import { groupBy } from '~/lib/utils';
import type { Photo } from '~/server/records';
import { store, useShallowStore } from '~/store';
import { matchesTextFilter } from '~/store/filter';
import { useHeaderSearch } from '~/store/header-search';

export function ActivityListView({
  activities,
  photos,
  filterIDs: ordinaryFilterIDs,
  hasNextPage = false,
  isFetching = false,
}: {
  activities?: Activity[];
  photos?: Photo[];
  filterIDs: number[];
  hasNextPage?: boolean;
  isFetching?: boolean;
}) {
  const browsingIDs = useBrowsingIDs(ordinaryFilterIDs);
  // While header search is open, the rows narrow as you type, by the same
  // rule as the text filter. Filter makes the narrowing that filter.
  const { searching, query, endSearch } = useHeaderSearch(
    useShallow((state) => ({
      searching: state.active,
      query: state.query,
      endSearch: state.end,
    })),
  );
  React.useEffect(() => {
    useHeaderSearch.setState({ narrowsRows: true });
    return () => useHeaderSearch.setState({ narrowsRows: false });
  }, []);
  const narrowing = React.useDeferredValue(searching ? query.trim() : '');
  const filterIDs = React.useMemo(() => {
    if (!narrowing || !activities) return browsingIDs;
    const byID = new Map(activities.map((activity) => [activity.id, activity]));
    return browsingIDs.filter((id) => {
      const activity = byID.get(id);
      return activity !== undefined && matchesTextFilter(activity, narrowing);
    });
  }, [browsingIDs, activities, narrowing]);
  const filterIDSet = React.useMemo(() => new Set(filterIDs), [filterIDs]);
  const eligibleIDSet = React.useMemo(
    () => new Set(ordinaryFilterIDs),
    [ordinaryFilterIDs],
  );
  const showOnMap = useShowOnMap(activities);
  const columns = React.useMemo(
    () => activityColumns(showOnMap, eligibleIDSet),
    [showOnMap, eligibleIDSet],
  );
  const { selected, setSelected, tableState } = useShallowStore((state) => ({
    selected: state.selected,
    setSelected: state.setSelected,
    tableState: state.fullList,
  }));

  // The open card is local to the list: browsing details must not select an
  // activity or change the route highlighted on the map.
  const { containerRef, activeId, presentation, ready, open, close } =
    useListInspection();

  React.useEffect(() => {
    if (!activeId || activities === undefined || filterIDSet.has(activeId))
      return;
    // A deep link may point into a later streamed page. Only reject a missing
    // identity once loading finishes; filters can dismiss an already loaded row.
    if (
      activities.some((activity) => activity.id === activeId) ||
      (!hasNextPage && !isFetching)
    )
      close();
  }, [activeId, activities, filterIDSet, hasNextPage, isFetching, close]);

  const columnFilters = React.useMemo(
    () => [{ id: 'id', value: filterIDSet }],
    [filterIDSet],
  );
  const photoDict = React.useMemo(
    () => groupBy(photos ?? [], (photo) => photo.activity_id),
    [photos],
  );

  const rows = React.useMemo(() => {
    return (activities ?? []).map((act) => {
      return {
        ...act,
        ...(act.id in photoDict && { photos: photoDict[act.id] }),
      };
    });
  }, [activities, photoDict]);

  return (
    <div
      ref={containerRef}
      data-list-inspection-ready={ready}
      className="flex h-full max-h-dvh w-full flex-col bg-muted"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {narrowing && (
        <div
          data-testid="list-search-narrowing"
          className="flex h-11 items-center gap-3 border-b bg-background px-3 text-sm"
        >
          <span role="status" className="text-muted-foreground tabular-nums">
            {filterIDs.length} {filterIDs.length === 1 ? 'match' : 'matches'}
          </span>
          <button
            type="button"
            data-testid="list-search-apply-filter"
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--activity-accent)]/10 px-3 text-[var(--activity-accent)] hover:bg-[var(--activity-accent)]/20"
            onClick={() => {
              applyTextFilter(store, narrowing, activities ?? [], false);
              endSearch();
            }}
          >
            <ListFilter className="size-4" aria-hidden />
            Filter
          </button>
        </div>
      )}
      <DataTable
        browsingKey="list"
        browsingDataReady={
          activities !== undefined && !hasNextPage && !isFetching
        }
        className="min-h-0 flex-1"
        columns={columns}
        data={rows}
        selected={selected}
        selectionActions={
          <SelectionShareButton activities={activities ?? []} />
        }
        setSelected={setSelected}
        columnFilters={columnFilters}
        activeId={ready ? activeId : 0}
        onRowClick={(row) => open(row.original.id)}
        onDetailBack={close}
        detailPresentation={presentation}
        detailStepping
        renderDetails={(row) => (
          <ActivityCardContent
            key={row.id}
            activity={row.original}
            stickyHeader
            onShowOnMap={showOnMap}
            mapActionVariant={
              eligibleIDSet.has(row.original.id)
                ? 'show'
                : 'clear-filters-and-show'
            }
          />
        )}
        {...tableState}
      />
    </div>
  );
}
