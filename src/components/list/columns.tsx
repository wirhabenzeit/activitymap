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

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretSortIcon,
} from '@radix-ui/react-icons';
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
import { desc } from 'drizzle-orm';

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
  row: Row<ActivityColumn>;
  setSelected: (value: any) => void; // Replace 'any' with the appropriate type for 'setSelected'
}

export function ActivityCardO({
  className,
  row,
  setSelected,
  ...props
}: ActivityCardProps) {
  const date = new Date(row.original.start_date_local_timestamp * 1000);
  const stats = [
    {
      title: 'When?',
      description: date.toLocaleString('en-US'),
    },
    {
      title: 'How long?',
      description: `${duration(row.getValue('moving_time'))} (moving), ${duration(
        row.getValue('elapsed_time'),
      )} (elapsed)`,
    },
    {
      title: 'How far?',
      description: decFormatter('km', 1)(row.original.distance / 1000),
    },
    {
      title: 'How high?',
      description: `Gain: ${decFormatter('m', 0)(row.getValue('total_elevation_gain'))}, High: ${decFormatter(
        'm',
        0,
      )(row.getValue('elev_high'))}`,
    },
    ...(row.getValue('average_heartrate')
      ? [
          {
            title: 'How hard?',
            description: `Avg: ${decFormatter('bpm', 0)(row.getValue('average_heartrate'))}, Max: ${decFormatter(
              'bpm',
              0,
            )(row.getValue('max_heartrate'))}`,
          },
        ]
      : []),
    ...(row.getValue('weighted_average_watts')
      ? [
          {
            title: 'How strong?',
            description: `Normalized: ${decFormatter('W', 0)(row.getValue('weighted_average_watts'))} Avg: ${decFormatter('W', 0)(row.getValue('average_watts'))}, Max: ${decFormatter(
              'W',
              0,
            )(row.getValue('max_watts'))}`,
          },
        ]
      : []),
  ];

  return (
    <Card className={cn('w-[380px]', className)} {...props}>
      <CardHeader>
        <CardTitle>{row.getValue('name')}</CardTitle>
        <CardDescription>{row.getValue('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div>
          {stats.map((stat, index) => (
            <div
              key={index}
              className="mb-4 grid grid-cols-[25px_1fr] items-start pb-0 last:mb-0 last:pb-0"
            >
              <span className="flex h-2 w-2 translate-y-1 rounded-full bg-sky-500" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">{stat.title}</p>
                <p className="text-sm text-muted-foreground">
                  {stat.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex gap-x-2">
        <Button className="flex-1" asChild>
          <a
            href={`https://strava.com/activities/${row.getValue('id')}`}
            target="_blank"
          >
            Strava
          </a>
        </Button>
        <Button className="flex-1" onClick={() => row.toggleSelected(true)}>
          <Link href="/map">Map</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ActivityCard({ row }) {
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
            <h4 className="text-sm font-semibold">{row.getValue('name')}</h4>
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
    </HoverCard>
  );
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
    size: 20,
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
    cell: ({ row }) => <ActivityCard row={row} />,
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
