'use client';

import React from 'react';
import { columns } from '../../components/list/columns';
import { DataTable } from '../../components/list/data-table';
import { groupBy } from '~/lib/utils';
import { useShallowStore } from '~/store';

export default function ListPage() {
  const { selected, setSelected, activityDict, filterIDs, tableState, photos } =
    useShallowStore((state) => ({
      selected: state.selected,
      setSelected: state.setSelected,
      activityDict: state.activityDict,
      filterIDs: state.filterIDs,
      tableState: state.fullList,
      photos: state.photos,
    }));

  const columnFilters = [{ id: 'id', value: filterIDs }];
  const photoDict = React.useMemo(
    () => groupBy(photos, (photo) => photo.activity_id),
    [photos],
  );

  const rows = React.useMemo(() => {
    const result = Object.entries(activityDict).map(([idStr, act]) => {
      const id = parseInt(idStr);

      return {
        ...act,
        ...(id in photoDict && { photos: photoDict[id] }),
      };
    });
    return result;
  }, [activityDict, photoDict]);

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
        {...(tableState as any)}
      />
    </div>
  );
}
