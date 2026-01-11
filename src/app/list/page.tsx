'use client';

import React from 'react';
import { columns } from '../../components/list/columns';
import { DataTable } from '../../components/list/data-table';
import { groupBy } from '~/lib/utils';
import { useShallowStore } from '~/store';

import { useActivities } from '~/hooks/use-activities';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import { usePhotos } from '~/hooks/use-photos';

export default function ListPage() {
  const { selected, setSelected, tableState } =
    useShallowStore((state) => ({
      selected: state.selected,
      setSelected: state.setSelected,
      tableState: state.fullList,
    }));

  const { data: activities = [] } = useActivities();
  const { data: photos = [] } = usePhotos();
  const { filterIDs } = useFilteredActivities();

  const columnFilters = [{ id: 'id', value: filterIDs }];
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
        {...(tableState as any)}
      />
    </div>
  );
}
