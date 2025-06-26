'use client';

import React from 'react';
import { columns } from '../list/columns';
import { DataTable } from '../list/data-table';
import { groupBy } from '~/lib/utils';
import { useShallowStore } from '~/store';

const ListView = React.memo(function ListView() {
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
  const photoDict = React.useMemo(() => groupBy(photos, (photo) => photo.activity_id), [photos]);

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
    <div className="h-full max-h-dvh w-full">
      <DataTable
        className="h-full"
        columns={columns}
        data={rows}
        selected={selected}
        setSelected={setSelected}
        columnFilters={columnFilters}
        {...tableState}
      />
    </div>
  );
});

export default ListView;