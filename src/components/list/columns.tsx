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

function columnFromField<K extends ActivityValueType>(
  id: keyof typeof activityFields,
  spec: ActivityField<K>,
): ColumnDef<Activity> {
  const footer = ({ table }: { table: Table<Activity> }) => {
    const rows =
      table.getState().summaryRow == null
        ? []
        : table.getState().summaryRow == 'page'
          ? table.getRowModel().rows
          : table.getState().summaryRow == 'all'
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
    enableResizing: true,
    ...(spec.accessorFn && { accessorFn: spec.accessorFn }),
    ...(!spec.accessorFn && { accessorKey: id }),
    ...((spec.reducer ?? spec.summary) && { footer }),
  };
}

export const columns: ColumnDef<Activity>[] = [
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
              onClick={() => column.pin(column.getIsPinned() ? false : 'left')}
            >
              <Pin />
            </Button>
          </div>
        </div>
      </DataTableColumnHeader>
    ),
    cell: ({ row, table }) => {
      const mapRef = table.getState().map;
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
    enableResizing: true,
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
    id: 'is_complete',
    accessorKey: 'is_complete',
    meta: { title: 'Complete', width: 'minmax(80px, 1fr)' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Complete" />
    ),
    cell: ({ getValue }) => {
      const isComplete = getValue() as boolean;
      return (
        <div className="text-right w-full">{isComplete ? 'Yes' : 'No'}</div>
      );
    },
  },
  {
    id: 'edit',
    meta: { title: 'Edit', width: '40px' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Edit" />
    ),
    cell: ({ row }) => <EditActivity row={row} trigger={true} />,
    enableResizing: false,
    size: 40,
    accessorFn: (row) => row.id,
  },
];
