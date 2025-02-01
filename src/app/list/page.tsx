'use client';

import { columns } from '../../components/list/columns';
import { DataTable } from '../../components/list/data-table';

import { useStore } from '~/contexts/Zustand';
import { useShallow } from 'zustand/shallow';
import React from 'react';

export default function ListPage() {
  const { selected, setSelected, activityDict, filterIDs, tableState } =
    useStore(
      useShallow((state) => ({
        selected: state.selected,
        setSelected: state.setSelected,
        activityDict: state.activityDict,
        filterIDs: state.filterIDs,
        tableState: state.fullList,
      })),
    );

  const columnFilters = [{ id: 'id', value: filterIDs }];
  const rows = React.useMemo(() => Object.values(activityDict), [activityDict]);

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
