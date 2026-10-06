'use client';

import React from 'react';
import { columns } from '~/components/list/columns';
import { DataTable } from '~/components/list/data-table';
import { ActivityCardContent } from '~/components/list/card';
import { groupBy } from '~/lib/utils';
import { useShallowStore } from '~/store';

import { useActivities } from '~/hooks/use-activities';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import { usePhotos } from '~/hooks/use-photos';

export default function ListPage() {
  const { selected, setSelected, tableState } = useShallowStore((state) => ({
    selected: state.selected,
    setSelected: state.setSelected,
    tableState: state.fullList,
  }));

  // The open card is local to the list: browsing details must not select an
  // activity or change the route highlighted on the map.
  const [openId, setOpenId] = React.useState(0);
  const { data: activities = [] } = useActivities();
  const { data: photos = [] } = usePhotos();
  const { filterIDs } = useFilteredActivities(activities);

  if (openId && !filterIDs.includes(openId)) setOpenId(0);

  const columnFilters = React.useMemo(
    () => [{ id: 'id', value: filterIDs }],
    [filterIDs],
  );
  const photoDict = React.useMemo(
    () => groupBy(photos, (photo) => photo.activity_id),
    [photos],
  );

  const rows = React.useMemo(() => {
    return activities.map((act) => {
      return {
        ...act,
        ...(act.id in photoDict && { photos: photoDict[act.id] }),
      };
    });
  }, [activities, photoDict]);

  return (
    <div
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
        activeId={openId}
        onRowClick={(row) => setOpenId(row.original.id)}
        onDetailBack={() => setOpenId(0)}
        renderDetails={(row) => (
          <ActivityCardContent key={row.id} row={row} stickyHeader />
        )}
        {...tableState}
      />
    </div>
  );
}
