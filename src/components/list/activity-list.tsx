'use client';

import React from 'react';
import { columns } from '~/components/list/columns';
import { DataTable } from '~/components/list/data-table';
import { ActivityCardContent } from '~/components/list/card';
import { groupBy } from '~/lib/utils';
import { useShallowStore } from '~/store';

import { type Activity, type Photo } from '~/server/db/schema';
import { useListInspection } from '~/hooks/use-list-inspection';

export function ActivityListView({
  activities,
  photos,
  filterIDs,
  hasNextPage = false,
  isFetching = false,
}: {
  activities?: Activity[];
  photos?: Photo[];
  filterIDs: number[];
  hasNextPage?: boolean;
  isFetching?: boolean;
}) {
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
    if (!activeId || activities === undefined || filterIDs.includes(activeId))
      return;
    // A deep link may point into a later streamed page. Only reject a missing
    // identity once loading finishes; filters can dismiss an already loaded row.
    if (
      activities.some((activity) => activity.id === activeId) ||
      (!hasNextPage && !isFetching)
    )
      close();
  }, [activeId, activities, filterIDs, hasNextPage, isFetching, close]);

  const columnFilters = React.useMemo(
    () => [{ id: 'id', value: filterIDs }],
    [filterIDs],
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
      className="h-full max-h-dvh w-full bg-muted"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <DataTable
        className="h-full"
        columns={columns}
        data={rows}
        selected={selected}
        setSelected={setSelected}
        columnFilters={columnFilters}
        activeId={ready ? activeId : 0}
        onRowClick={(row) => open(row.original.id)}
        onDetailBack={close}
        detailPresentation={presentation}
        detailStepping
        renderDetails={(row) => (
          <ActivityCardContent key={row.id} row={row} stickyHeader />
        )}
        {...tableState}
      />
    </div>
  );
}
