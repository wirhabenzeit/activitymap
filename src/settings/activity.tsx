import { Calendar, Clock, Heart, Mountain, Zap } from 'lucide-react';
import { RulerHorizontalIcon, StopwatchIcon } from '@radix-ui/react-icons';
import { Activity } from '~/server/db/schema';
import * as d3 from 'd3';

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

export const activityFields = {
  distance: {
    formatter: (distance: number) => decFormatter('km', 1)(distance / 1000),
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
    formatter: decFormatter('m', 0),
    Icon: Mountain,
    title: 'Elevation Gain',
    reducer: d3.sum,
  },
  elev_high: {
    formatter: decFormatter('m', 0),
    Icon: Mountain,
    title: 'Elevation High',
    reducer: d3.max,
    reducerSymbol: '≤',
  },
  elev_low: {
    formatter: decFormatter('m', 0),
    Icon: Mountain,
    title: 'Elevation Low',
    reducer: d3.min,
    reducerSymbol: '≥',
  },
  date: {
    accessorFn: (act: Activity) =>
      new Date(act.start_date_local_timestamp * 1000),
    formatter: (date: Date) =>
      date.toLocaleDateString('en-US', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      }),
    Icon: Calendar,
    title: 'Date',
    reducer: (v: Date[]) =>
      new Set(
        v.map((d) =>
          d.toLocaleDateString('en-US', {
            month: '2-digit',
            year: '2-digit',
            day: '2-digit',
          }),
        ),
      ).size,
    summaryFormatter: (v: Number) => `${v}d`,
  },
  average_speed: {
    formatter: (v: Number) => decFormatter('kmh', 1)(v * 3.6),
    Icon: Clock,
    title: 'Average Speed',
    reducer: d3.mean,
    reducerSymbol: '∅',
  },
  weighted_average_watts: {
    formatter: decFormatter('W', 0),
    Icon: Zap,
    title: 'Weighted Average Watts',
    reducer: d3.mean,
    reducerSymbol: '∅',
  },
  average_watts: {
    formatter: decFormatter('W', 0),
    Icon: Zap,
    title: 'Average Watts',
    reducer: d3.mean,
    reducerSymbol: '∅',
  },
  max_watts: {
    formatter: decFormatter('W', 0),
    Icon: Zap,
    title: 'Max Watts',
    reducer: d3.max,
    reducerSymbol: '≤',
  },
  max_heartrate: {
    formatter: decFormatter('bpm', 0),
    Icon: Heart,
    title: 'Max Heartrate',
    reducer: d3.max,
    reducerSymbol: '≤',
  },
  average_heartrate: {
    formatter: decFormatter('bpm', 0),
    Icon: Heart,
    title: 'Average Heartrate',
    reducer: d3.mean,
    reducerSymbol: '∅',
  },
};
