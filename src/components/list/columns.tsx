'use client';

import { ColumnDef, Table } from '@tanstack/react-table';
import {
  Calendar,
  Clock,
  Gauge,
  Mountain,
  Heart,
  Zap,
  Pin,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import { Checkbox } from '~/components/ui/checkbox';

import { Activity, SportType } from '~/server/db/schema';
import { categorySettings } from '~/settings/category';
import { Button } from '~/components/ui/button';

import { DataTableColumnHeader } from './data-table';
import { aliasMap } from '~/settings/category';
import Link from 'next/link';
import { RulerHorizontalIcon, StopwatchIcon } from '@radix-ui/react-icons';
import { activityFields } from '~/settings/activity';

import * as d3 from 'd3';

import { type Row } from '@tanstack/react-table';

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '~/components/ui/hover-card';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

import { cn } from '~/lib/utils';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { title } from 'process';
import { access } from 'fs';
import { HoverCardPortal } from '@radix-ui/react-hover-card';

function decFormatter(unit = '', decimals = 0) {
  return (num: number | undefined) =>
    num == undefined ? null : num.toFixed(decimals) + unit;
}

const duration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return Math.floor(minutes / 60) + 'h' + String(minutes % 60).padStart(2, '0');
};

type CardProps = React.ComponentProps<typeof Card>;

interface ActivityCardProps extends CardProps {
  row: Row<Activity>;
}

function ActivityCard({ row }: ActivityCardProps) {
  const sport_type = row.original.sport_type;
  const sport_group = aliasMap[sport_type]!;
  const Icon = categorySettings[sport_group].icon;

  const date = new Date(row.original.start_date_local_timestamp * 1000);
  const stats = [
    {
      icon: Calendar,
      description: date.toLocaleString('en-US'),
    },
    {
      icon: StopwatchIcon,
      description: `${duration(row.getValue('moving_time'))} (moving), ${duration(
        row.getValue('elapsed_time'),
      )} (elapsed)`,
    },
    {
      icon: RulerHorizontalIcon,
      description: decFormatter('km', 1)(row.original.distance / 1000),
    },
    {
      icon: Mountain,
      description: `+${decFormatter('m', 0)(row.original.total_elevation_gain)} (${decFormatter(
        'mas',
        0,
      )(row.getValue('elev_high'))})`,
    },
    ...(row.getValue('average_heartrate')
      ? [
          {
            icon: Heart,
            description: `${decFormatter('bpm', 0)(row.getValue('average_heartrate'))} (avg), ${decFormatter(
              'bpm',
              0,
            )(row.getValue('max_heartrate'))} (max)`,
          },
        ]
      : []),
    ...(row.getValue('weighted_average_watts')
      ? [
          {
            icon: Zap,
            description: `${decFormatter('W', 0)(row.getValue('weighted_average_watts'))} (norm), ${decFormatter('W', 0)(row.getValue('average_watts'))} (avg)`,
          },
        ]
      : []),
  ];

  return (
    <span className="flex items-center space-x-2">
      <Button
        variant={row.getIsSelected() ? 'outline' : 'ghost'}
        size="sm"
        className="h-6 w-6 border"
        onClick={() => row.toggleSelected()}
        aria-label="Select row"
      >
        <Icon color={categorySettings[sport_group].color} />
      </Button>
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button
            asChild
            variant="link"
            className="text-left truncate underline justify-start max-w-full px-0"
            size="sm"
          >
            <Link
              href={`https://strava.com/activities/${row.getValue('id')}`}
              target="_blank"
            >
              {row.getValue('name')}
            </Link>
          </Button>
        </HoverCardTrigger>
        <HoverCardPortal>
          <HoverCardContent className="w-auto max-w-80">
            <div className="flex justify-between space-x-4">
              <Avatar>
                <AvatarFallback>
                  <Icon
                    color={categorySettings[sport_group].color}
                    className="w-6 h-6"
                    height="3em"
                  />
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">
                  {row.getValue('name')}
                </h4>
                <p className="text-sm">{row.getValue('description') || ''}</p>
                {stats.map((stat, index) => (
                  <div className="flex items-center pt-2" key={index}>
                    <stat.icon className="mr-2 h-4 w-4 opacity-70" />{' '}
                    <span className="text-xs text-muted-foreground">
                      {stat.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </HoverCardContent>
        </HoverCardPortal>
      </HoverCard>
    </span>
  );
}

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
    console.log(id, table.getState().summaryRow, rows.length);
    const reducedValue = spec.reducer(rows.map((row) => row.getValue(id)));
    const summary = spec.summaryFormatter
      ? spec.summaryFormatter(reducedValue)
      : `${spec.reducerSymbol || ''}${spec.formatter(reducedValue)}`;
    return <div className="text-right">{summary}</div>;
  };

  return {
    id,
    cell: ({ getValue }) => (
      <div className="text-right">{spec.formatter(getValue())}</div>
    ),
    meta: title,
    header: ({ column, table }) => (
      <DataTableColumnHeader table={table} column={column}>
        {spec.Icon && <spec.Icon className="w-4 h-4" />}
        {/* <span>{title}</span> */}
      </DataTableColumnHeader>
    ),
    size: 60,
    enableResizing: false,
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
              onClick={() =>
                table.setColumnPinning(({ left }) => ({
                  left: left?.includes('name') ? [] : ['name'],
                }))
              }
            >
              <Pin />
            </Button>
          </div>
        </div>
      </DataTableColumnHeader>
    ),
    size: 150,
    cell: ({ row, getValue }) => <ActivityCard row={row} />,
    enableHiding: false,
  },
  ...Object.entries(activityFields).map(([id, spec]) =>
    columnFromField(id, spec),
  ),
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
