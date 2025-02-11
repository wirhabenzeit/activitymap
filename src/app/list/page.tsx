'use client';

import { columns } from '../../components/list/columns';
import { DataTable } from '../../components/list/data-table';

import { useShallowStore } from '~/store';

import React from 'react';
import { Photo } from '~/server/db/schema';

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
  const photoDict = photos.reduce(
    (acc, photo) => {
      if (photo.activity_id in acc) acc[photo.activity_id].push(photo);
      else acc[photo.activity_id] = [photo];
      return acc;
    },
    {} as Record<number, Photo[]>,
  );
  const rows = React.useMemo(
    () =>
      Object.entries(activityDict).map(([id, act]) => ({
        ...act,
        ...(id in photoDict && { photos: photoDict[id] }),
      })),
    [activityDict, photos],
  );

  return (
    <div className="h-full max-h-dvh w-full">
      <DataTable
        className="h-full"
        columns={columns}
        data={rows}
        selected={selected}
        setSelected={setSelected}
        filterIDs={filterIDs}
        columnFilters={columnFilters}
        {...tableState}
      />
    </div>
  );
}
