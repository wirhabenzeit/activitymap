'use client';

import { ColumnDef, Table } from '@tanstack/react-table';
import { Edit, Pin } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import { Checkbox } from '~/components/ui/checkbox';

import { Activity } from '~/server/db/schema';
import { Button } from '~/components/ui/button';

import { DataTableColumnHeader } from './data-table';
import { activityFields } from '~/settings/activity';

import { ActivityCard } from './card';
import { EditButton } from './edit';

function columnFromField(
  id: keyof typeof activityFields,
  spec: (typeof activityFields)[keyof typeof activityFields],
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
    const reducedValue = spec.reducer(rows.map((row) => row.getValue(id)));
    const summary = spec.summaryFormatter
      ? spec.summaryFormatter(reducedValue)
      : `${spec.reducerSymbol || ''}${spec.formatter(reducedValue)}`;
    return <div className="text-right w-full">{summary}</div>;
  };

  return {
    id,
    cell: ({ getValue }) => (
      <div className="text-right w-full">{spec.formatter(getValue())}</div>
    ),
    meta: {
      title: spec.title,
      width: 'minmax(70px, 1fr)',
    },
    header: ({ column, table }) => (
      <DataTableColumnHeader table={table} column={column}>
        {spec.Icon && <spec.Icon className="w-4 h-4" />}
        {/* <span>{title}</span> */}
      </DataTableColumnHeader>
    ),
    enableResizing: true,
    ...(spec.accessorFn && { accessorFn: spec.accessorFn }),
    ...(!spec.accessorFn && { accessorKey: id }),
    ...(spec.reducer && { footer }),
  };
}

export const columns: ColumnDef<Activity>[] = [
  {
    accessorKey: 'id',
    header: ({ column, table }) => (
      <DataTableColumnHeader table={table} column={column} title="ID" />
    ),
    enableHiding: false,
    filterFn: (row, columnId, filterValue) => {
      return filterValue.includes(row.id);
    },
  },
  {
    accessorKey: 'name',
    meta: { title: 'Name', width: 'minmax(200px, 3fr)' },
    header: ({ column, table }) => (
      <DataTableColumnHeader table={table} column={column}>
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
    cell: ({ row }) => <ActivityCard row={row} />,
    enableHiding: false,
  },
  ...Object.entries(activityFields).map(([id, spec]) =>
    columnFromField(id, spec),
  ),
  {
    accessorKey: 'description',
    meta: { title: 'Description', width: 'minmax(200px, 3fr)' },
    header: ({ column, table }) => (
      <DataTableColumnHeader
        table={table}
        column={column}
        title="Description"
      />
    ),
    enableResizing: true,
    cell: ({ row }) => (
      <Popover>
        <PopoverTrigger asChild>
          <div className="w-full truncate italic">
            {row.original.description}
          </div>
        </PopoverTrigger>
        <PopoverContent>
          <div className="text-sm">{row.getValue('name')}</div>
          <span className="text-sm italic">{row.original.description}</span>
        </PopoverContent>
      </Popover>
    ),
  },
  {
    id: 'edit',
    meta: { title: 'Edit', width: '40px' },
    header: ({ column, table }) => <div>Edit</div>,
    cell: ({ row }) => <EditButton row={row} />,
    enableResizing: false,
    size: 40,
    accessorFn: (row) => row.id,
  },
];
