'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Calendar, Clock, Gauge, Mountain, Heart, Zap } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import { Checkbox } from '~/components/ui/checkbox';

import { SportType } from '~/server/db/schema';
import { categorySettings } from '~/settings/category';
import { Button } from '~/components/ui/button';

import { DataTableColumnHeader } from './data-table';
import { aliasMap } from '~/settings/category';
import Link from 'next/link';
import { RulerHorizontalIcon, StopwatchIcon } from '@radix-ui/react-icons';

function decFormatter(unit = '', decimals = 0) {
  return (num: number | undefined) =>
    num == undefined ? null : num.toFixed(decimals) + unit;
}

export type ActivityColumn = {
  id: number;
  name: string;
  description: string | null;
  sport_type: SportType;
  start_date_local_timestamp: number;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  average_speed: number;
  total_elevation_gain: number;
  elev_high: number;
  elev_low: number;
  weighted_average_watts: number;
  average_watts: number;
  max_watts: number;
  average_heartrate: number;
  max_heartrate: number;
  kudos_count: number;
};

export const columns: ColumnDef<ActivityColumn>[] = [
  {
    id: 'select',
    accessorKey: 'sport_type',
    size: 28,
    header: ({ table, column }) => (
      <DataTableColumnHeader
        table={table}
        dropdown={false}
        title={
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
        }
        column={column}
      />
    ),
    sortingFn: (rowA, rowB, columnID) =>
      rowA.getIsSelected() ? 1 : rowB.getIsSelected() ? -1 : 0,
    cell: ({ row }) => {
      const sport_type = row.original.sport_type;
      const sport_group = aliasMap[sport_type]!;
      const Icon = categorySettings[sport_group].icon;
      return (
        <Button
          variant={row.getIsSelected() ? 'outline' : 'secondary'}
          size="sm"
          className="h-6 w-6"
          onClick={() => row.toggleSelected()}
          aria-label="Select row"
        >
          <Icon color={categorySettings[sport_group].color} />
        </Button>
      );
    },
    enableHiding: false,
  },
  {
    id: 'id',
    accessorKey: 'id',
    header: ({ column, table }) => (
      <DataTableColumnHeader table={table} column={column} title="ID" />
    ),
  },
  {
    accessorKey: 'name',
    header: ({ column, table }) => (
      <DataTableColumnHeader table={table} column={column} title="Name" />
    ),
    size: 150,
    cell: ({ row }) => (
      <div className="truncate text-left">
        <Button asChild variant="link" className="px-0" size="sm">
          <Link
            href={`https://strava.com/activities/${row.getValue('id')}`}
            target="_blank"
          >
            {row.getValue('name')}
          </Link>
        </Button>
      </div>
    ),
  },
  {
    id: 'date',
    size: 60,
    accessorKey: 'start_date_local_timestamp',
    header: ({ column, table }) => (
      <DataTableColumnHeader
        table={table}
        column={column}
        title={<Calendar />}
      />
    ),
    cell: ({ row }) => {
      return (
        <div className="text-right">
          {new Date(
            row.original.start_date_local_timestamp * 1000,
          ).toLocaleDateString('en-US', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
          })}
        </div>
      );
    },
  },
  {
    id: 'time',
    size: 60,
    accessorKey: 'start_date_local_timestamp',
    header: ({ column, table }) => (
      <DataTableColumnHeader table={table} column={column} title={<Clock />} />
    ),
    cell: ({ row }) => {
      const date = new Date(row.original.start_date_local_timestamp * 1000);
      return (
        <div className="text-right">
          {String(date.getHours()).padStart(2, '0') +
            ':' +
            String(date.getMinutes()).padStart(2, '0')}
        </div>
      );
    },
  },
  {
    accessorKey: 'elapsed_time',
    header: ({ column, table }) => (
      <DataTableColumnHeader
        table={table}
        column={column}
        title={<StopwatchIcon />}
      />
    ),
    size: 60,
    cell: ({ row }) => {
      const minutes = Math.floor(row.original.elapsed_time / 60);
      return (
        <div className="text-right">
          {Math.floor(minutes / 60) +
            'h' +
            String(minutes % 60).padStart(2, '0')}
        </div>
      );
    },
  },
  {
    accessorKey: 'moving_time',
    header: ({ column, table }) => (
      <DataTableColumnHeader
        table={table}
        column={column}
        title="Moving Time"
      />
    ),
    cell: ({ row }) => {
      const minutes = Math.floor(row.original.moving_time / 60);
      return (
        <div className="text-right">
          {Math.floor(minutes / 60) +
            'h' +
            String(minutes % 60).padStart(2, '0')}
        </div>
      );
    },
  },
  {
    accessorKey: 'distance',
    header: ({ column, table }) => (
      <DataTableColumnHeader
        table={table}
        column={column}
        title={<RulerHorizontalIcon />}
      />
    ),
    size: 60,
    cell: ({ row }) => (
      <div className="text-right">
        {decFormatter('km', 1)(row.original.distance / 1000)}
      </div>
    ),
  },
  {
    accessorKey: 'average_speed',
    header: ({ column, table }) => (
      <DataTableColumnHeader table={table} column={column} title={<Gauge />} />
    ),
    size: 80,
    cell: ({ row }) => (
      <div className="text-right">
        {decFormatter('km/h', 1)(row.original.average_speed * 3.6)}
      </div>
    ),
  },
  {
    accessorKey: 'total_elevation_gain',
    header: ({ column, table }) => (
      <DataTableColumnHeader
        table={table}
        column={column}
        title={<Mountain />}
        className="justify-right"
      />
    ),
    size: 60,
    cell: ({ row }) => (
      <div className="text-right">
        {decFormatter('m', 0)(row.original.total_elevation_gain)}{' '}
      </div>
    ),
  },
  {
    accessorKey: 'elev_high',
    header: ({ column, table }) => (
      <DataTableColumnHeader
        table={table}
        column={column}
        title="Elevation High"
      />
    ),
    cell: ({ row }) => decFormatter('m', 0)(row.getValue('elev_high')),
  },
  {
    accessorKey: 'elev_low',
    header: ({ column, table }) => (
      <DataTableColumnHeader
        table={table}
        column={column}
        title="Elevation Low"
      />
    ),
    cell: ({ row }) => decFormatter('m', 0)(row.getValue('elev_low')),
  },
  {
    accessorKey: 'weighted_average_watts',
    header: ({ column, table }) => (
      <DataTableColumnHeader
        table={table}
        column={column}
        title="Weighted Avg Watts"
      />
    ),
    cell: ({ row }) =>
      decFormatter('W')(row.getValue('weighted_average_watts')),
  },
  {
    accessorKey: 'average_watts',
    size: 60,
    header: ({ column, table }) => (
      <DataTableColumnHeader table={table} column={column} title={<Zap />} />
    ),
    cell: ({ row }) => (
      <div className="text-right">
        {decFormatter('W')(row.original.average_watts)}
      </div>
    ),
  },
  {
    accessorKey: 'max_watts',
    header: ({ column, table }) => (
      <DataTableColumnHeader table={table} column={column} title="Max Watts" />
    ),
    cell: ({ row }) => decFormatter('W')(row.getValue('max_watts')),
  },
  {
    accessorKey: 'average_heartrate',
    size: 80,
    header: ({ column, table }) => (
      <DataTableColumnHeader table={table} column={column} title={<Heart />} />
    ),
    cell: ({ row }) => (
      <div className="text-right">
        {decFormatter('bpm')(row.original.average_heartrate)}
      </div>
    ),
  },
  {
    accessorKey: 'max_heartrate',
    header: ({ column, table }) => (
      <DataTableColumnHeader
        table={table}
        column={column}
        title="Max Heartrate"
      />
    ),
    cell: ({ row }) => decFormatter('bpm')(row.getValue('max_heartrate')),
  },
  {
    accessorKey: 'description',
    header: ({ column, table }) => (
      <DataTableColumnHeader
        table={table}
        column={column}
        title="Description"
      />
    ),
    enableResizing: true,
    size: 200,
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
];
