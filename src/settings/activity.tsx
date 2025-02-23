import { Calendar, Clock, Heart, Mountain, Zap } from 'lucide-react';
import { RulerHorizontalIcon, StopwatchIcon } from '@radix-ui/react-icons';
import { type Activity } from '~/server/db/schema';
import * as d3 from 'd3';
import { type ComponentType } from 'react';

function decFormatter(unit = '', decimals = 0) {
  return (num: number | undefined) =>
    num == undefined ? null : num.toFixed(decimals) + unit;
}

function durationFormatter(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  if (days > 99) {
    return `${days}d`;
  } else if (days > 0) {
    return `${days}d${hours}h`;
  } else {
    return `${hours}h${minutes}m`;
  }
}

export type ActivityValueType = number | string | Date | boolean;

export type ActivityField<K> = {
  formatter: (value: K) => string;
  accessorFn?: (activity: Activity) => K;
  Icon?: ComponentType<{ className?: string }>;
  title: string;
  reducer?: (values: K[]) => K;
  reducerSymbol?: string;
  summary?: (values: K[]) => string;
};

export const activityFields = {
  distance: {
    formatter: (value: number) => decFormatter('km', 1)(value / 1000),
    Icon: RulerHorizontalIcon,
    title: 'Distance',
    reducer: d3.sum,
  },
  moving_time: {
    formatter: durationFormatter,
    Icon: StopwatchIcon,
    title: 'Moving Time',
    reducer: d3.sum,
  },
  elapsed_time: {
    formatter: durationFormatter,
    Icon: StopwatchIcon,
    title: 'Elapsed Time',
    reducer: d3.sum,
  },
  total_elevation_gain: {
    formatter: (v: number) => decFormatter('m', 0)(v),
    Icon: Mountain,
    title: 'Elevation Gain',
    reducer: d3.sum,
  },
  elev_high: {
    formatter: (v: number) => decFormatter('m', 0)(v),
    Icon: Mountain,
    title: 'Elevation High',
    reducer: d3.max,
    reducerSymbol: '≤',
  },
  elev_low: {
    formatter: (v: number) => decFormatter('m', 0)(v),
    Icon: Mountain,
    title: 'Elevation Low',
    reducer: d3.min,
    reducerSymbol: '≥',
  },
  date: {
    accessorFn: (act: Activity) => act.start_date_local,
    formatter: (date: Date) =>
      date.toLocaleDateString('en-US', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      }),
    Icon: Calendar,
    title: 'Date',
    summary: (v: Date[]) => {
      const dates = new Set(
        v.map((d) =>
          d.toLocaleDateString('en-US', {
            month: '2-digit',
            year: '2-digit',
            day: '2-digit',
          }),
        ),
      );
      return `${dates.size}d`;
    },
  },
  average_speed: {
    formatter: (v: number) => decFormatter('kmh', 1)(v * 3.6),
    Icon: Clock,
    title: 'Average Speed',
    reducer: d3.mean,
    reducerSymbol: '∅',
  },
  weighted_average_watts: {
    formatter: (v: number) => decFormatter('W', 0)(v),
    Icon: Zap,
    title: 'Weighted Average Watts',
    reducer: d3.mean,
    reducerSymbol: '∅',
  },
  average_watts: {
    formatter: (v: number) => decFormatter('W', 0)(v),
    Icon: Zap,
    title: 'Average Watts',
    reducer: d3.mean,
    reducerSymbol: '∅',
  },
  max_watts: {
    formatter: (v: number) => decFormatter('W', 0)(v),
    Icon: Zap,
    title: 'Max Watts',
    reducer: d3.max,
    reducerSymbol: '≤',
  },
  max_heartrate: {
    formatter: (v: number) => decFormatter('bpm', 0)(v),
    Icon: Heart,
    title: 'Max Heartrate',
    reducer: d3.max,
    reducerSymbol: '≤',
  },
  average_heartrate: {
    formatter: (v: number) => decFormatter('bpm', 0)(v),
    Icon: Heart,
    title: 'Average Heartrate',
    reducer: d3.mean,
    reducerSymbol: '∅',
  },
} as const;
