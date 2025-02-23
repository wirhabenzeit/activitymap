'use client';

import { columns } from '../../components/list/columns';
import { DataTable } from '../../components/list/data-table';

import { useShallowStore } from '~/store';

import React from 'react';

const groupBy = <T, K extends PropertyKey>(arr: T[], key: (i: T) => K) =>
  arr.reduce(
    (groups, item) => {
      (groups[key(item)] ||= []).push(item);
      return groups;
    },
    {} as Record<K, T[]>,
  );

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
  const photoDict = groupBy(photos, (photo) => photo.activity_id);

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
}
