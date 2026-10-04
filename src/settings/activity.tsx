import { Calendar, Clock, Heart, Mountain, Zap } from 'lucide-react';
import { RulerHorizontalIcon, StopwatchIcon } from '@radix-ui/react-icons';
import { type Activity } from '~/server/db/schema';
import { formatPreferredDate, type DateFormat } from '~/lib/date-preferences';
import { formatLocalDate } from '~/lib/local-date-time';
import { aggregateMetric } from '~/lib/activity-presentation';
import { formatMeasurement, type UnitSystem } from '~/lib/units';
import { type ComponentType } from 'react';

function decFormatter(unit = '', decimals = 0) {
  return (num: number | undefined) =>
    num == undefined || !Number.isFinite(num)
      ? '—'
      : num.toFixed(decimals) + (unit ? ' ' + unit : '');
}

function durationFormatter(seconds: number) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
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
  formatter: (value: K, units?: UnitSystem, dateFormat?: DateFormat) => string;
  accessorFn?: (activity: Activity) => K;
  Icon?: ComponentType<{ className?: string }>;
  title: string;
  reducer?: (values: K[]) => K | null;
  reducerSymbol?: string;
  summary?: (values: K[]) => string;
};

export const activityFields = {
  distance: {
    formatter: (value: number, units: UnitSystem = 'metric') =>
      formatMeasurement(value, 'distance', units),
    Icon: RulerHorizontalIcon,
    title: 'Distance',
    reducer: (values: number[]) => aggregateMetric(values, 'sum').value,
  },
  moving_time: {
    formatter: durationFormatter,
    Icon: StopwatchIcon,
    title: 'Moving Time',
    reducer: (values: number[]) => aggregateMetric(values, 'sum').value,
  },
  elapsed_time: {
    formatter: durationFormatter,
    Icon: StopwatchIcon,
    title: 'Elapsed Time',
    reducer: (values: number[]) => aggregateMetric(values, 'sum').value,
  },
  total_elevation_gain: {
    formatter: (v: number, units: UnitSystem = 'metric') =>
      formatMeasurement(v, 'elevation', units),
    Icon: Mountain,
    title: 'Elevation Gain',
    reducer: (values: number[]) => aggregateMetric(values, 'sum').value,
  },
  elev_high: {
    formatter: (v: number, units: UnitSystem = 'metric') =>
      formatMeasurement(v, 'elevation', units),
    Icon: Mountain,
    title: 'Elevation High',
    reducer: (values: number[]) => aggregateMetric(values, 'max').value,
    reducerSymbol: '≤',
  },
  elev_low: {
    formatter: (v: number, units: UnitSystem = 'metric') =>
      formatMeasurement(v, 'elevation', units),
    Icon: Mountain,
    title: 'Elevation Low',
    reducer: (values: number[]) => aggregateMetric(values, 'min').value,
    reducerSymbol: '≥',
  },
  date: {
    accessorFn: (act: Activity) => act.start_date_local,
    formatter: (
      date: Date,
      _units: UnitSystem = 'metric',
      dateFormat: DateFormat = 'system',
    ) => (date == null ? '—' : formatPreferredDate(date, dateFormat)),
    Icon: Calendar,
    title: 'Date',
    summary: (v: Date[]) => {
      const dates = new Set(
        v
          .filter((d) => d != null)
          .map((d) =>
            formatLocalDate(
              d,
              {
                month: '2-digit',
                year: '2-digit',
                day: '2-digit',
              },
              'en-US',
            ),
          ),
      );
      return `${dates.size}d`;
    },
  },
  average_speed: {
    formatter: (v: number, units: UnitSystem = 'metric') =>
      formatMeasurement(v, 'speed', units),
    Icon: Clock,
    title: 'Average Speed',
    reducer: (values: number[]) => aggregateMetric(values, 'mean').value,
    reducerSymbol: '∅',
  },
  weighted_average_watts: {
    formatter: (v: number) => decFormatter('W', 0)(v),
    Icon: Zap,
    title: 'Weighted Average Watts',
    reducer: (values: number[]) => aggregateMetric(values, 'mean').value,
    reducerSymbol: '∅',
  },
  average_watts: {
    formatter: (v: number) => decFormatter('W', 0)(v),
    Icon: Zap,
    title: 'Average Watts',
    reducer: (values: number[]) => aggregateMetric(values, 'mean').value,
    reducerSymbol: '∅',
  },
  max_watts: {
    formatter: (v: number) => decFormatter('W', 0)(v),
    Icon: Zap,
    title: 'Max Watts',
    reducer: (values: number[]) => aggregateMetric(values, 'max').value,
    reducerSymbol: '≤',
  },
  max_heartrate: {
    formatter: (v: number) => decFormatter('bpm', 0)(v),
    Icon: Heart,
    title: 'Max Heartrate',
    reducer: (values: number[]) => aggregateMetric(values, 'max').value,
    reducerSymbol: '≤',
  },
  average_heartrate: {
    formatter: (v: number) => decFormatter('bpm', 0)(v),
    Icon: Heart,
    title: 'Average Heartrate',
    reducer: (values: number[]) => aggregateMetric(values, 'mean').value,
    reducerSymbol: '∅',
  },
} as const;
