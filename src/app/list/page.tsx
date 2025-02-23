'use client';

import { columns } from '../../components/list/columns';
import { DataTable } from '../../components/list/data-table';

import { useShallowStore } from '~/store';

import React from 'react';
import { type Photo } from '~/server/db/schema';

export default function ListPage() {
  const {
    selected,
    setSelected,
    activityDict,
    filterIDs,
    tableState,
    photos,
    loaded,
  } = useShallowStore((state) => ({
    selected: state.selected,
    setSelected: state.setSelected,
    activityDict: state.activityDict,
    filterIDs: state.filterIDs,
    tableState: state.fullList,
    photos: state.photos,
    loaded: state.loaded,
  }));

  const columnFilters = [{ id: 'id', value: filterIDs }];
  const photoDict = photos.reduce(
    (acc, photo) => {
      const id = photo.activity_id;
      if (id in acc) {
        acc[id].push(photo);
      } else {
        acc[id] = [photo];
      }
      return acc;
    },
    {} as Record<number, Photo[]>,
  );
  const rows = React.useMemo(() => {
    return Object.values(activityDict).map((act) => {
      const photos = photoDict[(act as { id: number }).id] ?? [];
      return {
        ...act,
        photos,
      };
    });
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
}
