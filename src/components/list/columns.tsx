'use client';

import { type ColumnDef, type Table } from '@tanstack/react-table';
import { Pin } from 'lucide-react';
import { Checkbox } from '~/components/ui/checkbox';

import { type Activity, type Photo } from '~/server/db/schema';
import { Button } from '~/components/ui/button';

import { DataTableColumnHeader } from './data-table-column-header';
import {
  activityFields,
  type ActivityField,
  type ActivityValueType,
} from '~/settings/activity';

import { ActivityCard, DescriptionCard } from './card';
import { EditActivity } from './edit';
import { PhotoLightbox } from './photo';
import { type Features } from './table-extensions';

function columnFromField<K extends ActivityValueType>(
  id: keyof typeof activityFields,
  spec: ActivityField<K>,
): ColumnDef<Features, Activity> {
  const footer = ({ table }: { table: Table<Features, Activity> }) => {
    const rows =
      table.store.state.summaryRow == null
        ? []
        : table.store.state.summaryRow == 'page'
          ? table.getRowModel().rows
          : table.store.state.summaryRow == 'all'
            ? table.getFilteredRowModel().rows
            : table.getSelectedRowModel().rows;
    const values: K[] = rows.map((row) => row.getValue(id));
    const reducedValue = spec.reducer ? spec.reducer(values) : null;
    const summary = spec.summary
      ? spec.summary(values)
      : reducedValue != null
        ? `${spec.reducerSymbol ?? ''}${spec.formatter(reducedValue)}`
        : '';
    return <div className="text-right w-full">{summary}</div>;
  };

  return {
    id,
    cell: ({ getValue }) => (
      <div className="text-right w-full">{spec.formatter(getValue() as K)}</div>
    ),
    meta: {
      title: spec.title,
      width: 'minmax(70px, 1fr)',
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column}>
        <div className="w-full justify-end flex">
          {spec.Icon && <spec.Icon className="w-4 h-4" />}
        </div>
      </DataTableColumnHeader>
    ),
    ...(spec.accessorFn && { accessorFn: spec.accessorFn }),
    ...(!spec.accessorFn && { accessorKey: id }),
    ...((spec.reducer ?? spec.summary) && { footer }),
  };
}

export const columns: ColumnDef<Features, Activity>[] = [
  {
    id: 'id',
    accessorKey: 'id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="ID" />
    ),
    enableHiding: false,
    filterFn: (
      row: { original: Activity },
      _columnId: string,
      filterValue: number[],
    ) => filterValue.includes(row.original.id),
  },
  {
    id: 'name',
    accessorKey: 'name',
    meta: { title: 'Name', width: 'minmax(200px, 3fr)' },
    header: ({ column, table }) => (
      <DataTableColumnHeader column={column}>
        <div className="flex items-center space-x-2">
          <Checkbox
            className="h-6 w-6"
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="Select all"
          />
          <span>Name</span>
          <div className="flex-1 text-right">
            <Button
              variant={column.getIsPinned() ? 'outline' : 'ghost'}
              size="sm"
              className="p-1 border"
              onClick={() =>
                column.pin(column.getIsPinned() ? false : 'start')
              }
            >
              <Pin />
            </Button>
          </div>
        </div>
      </DataTableColumnHeader>
    ),
    cell: ({ row, table }) => {
      const mapRef = table.store.state.map;
      return (
        <ActivityCard
          row={row}
          map={mapRef}
        />
      );
    },
    enableHiding: false,
  },
  ...Object.entries(activityFields).map(([id, spec]) =>
    columnFromField(
      id as keyof typeof activityFields,
      spec as ActivityField<ActivityValueType>,
    ),
  ),
  {
    id: 'description',
    accessorKey: 'description',
    meta: { title: 'Description', width: 'minmax(200px, 3fr)' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Description" />
    ),
    cell: ({ row }) => <DescriptionCard row={row} />,
  },
  {
    id: 'photos',
    accessorKey: 'photos',
    meta: { title: 'Photos', width: 'minmax(80px, 1fr)' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Photos" />
    ),
    cell: ({ getValue, row }) => {
      const photos = getValue() as Photo[] | undefined;
      return (
        <PhotoLightbox photos={photos ?? []} title={row.getValue('name')} />
      );
    },
  },
  {
    id: 'geometry_state',
    accessorKey: 'geometryState',
    meta: { title: 'Geometry', width: 'minmax(100px, 1fr)' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Geometry" />
    ),
    cell: ({ getValue }) => {
      const geometryState = getValue() as Activity['geometryState'];
      return <div className="text-right w-full">{geometryState ?? 'Unknown'}</div>;
    },
  },
  {
    id: 'edit',
    meta: { title: 'Edit', width: '40px' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Edit" />
    ),
    cell: ({ row }) => <EditActivity row={row} trigger={true} />,
    accessorFn: (row) => row.id,
  },
];
