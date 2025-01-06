'use client';

import { columns } from '../../components/list/columns';
import { DataTable } from '../../components/list/data-table';

import { useStore } from '~/contexts/Zustand';
import { useShallow } from 'zustand/shallow';

export default function ListPage() {
  const {
    selected,
    setSelected,
    sorting,
    setSorting,
    columnVisibility,
    setColumnVisibility,
    activityDict,
    filterIDs,
  } = useStore(
    useShallow((state) => ({
      selected: state.selected,
      setSelected: state.setSelected,
      sorting: state.fullList.sorting,
      columnVisibility: state.fullList.columnVisibility,
      setSorting: state.fullList.setSorting,
      setColumnVisibility: state.fullList.setColumnVisibility,
      activityDict: state.activityDict,
      filterIDs: state.filterIDs,
    })),
  );

  const rows = filterIDs
    .map((key) => activityDict[key])
    .filter((x) => x != undefined);

  return (
    <div className="h-full max-h-dvh w-full">
      <DataTable
        columns={columns}
        data={rows}
        setSorting={setSorting}
        sorting={sorting}
        selected={selected}
        setSelected={setSelected}
        columnVisibility={columnVisibility}
        setColumnVisibility={setColumnVisibility}
      />
    </div>
  );
}
