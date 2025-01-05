'use client';

import { columns } from './columns';
import { DataTable, DataTablePagination } from './data-table';

import { useStore } from '~/contexts/Zustand';
import { useShallow } from 'zustand/shallow';

export default function DemoPage() {
  const { activityDict, filterIDs, selected, setSelected } = useStore(
    useShallow((state) => ({
      activityDict: state.activityDict,
      filterIDs: state.filterIDs,
      selected: state.selected,
      setSelected: state.setSelected,
    })),
  );
  const rows = filterIDs
    .map((key) => activityDict[key])
    .filter((x) => x != undefined);

  return (
    <div className="h-full max-h-dvh w-full">
      <DataTable columns={columns} data={rows} />
    </div>
  );
}
