import { type ComponentType } from 'react';

import type { Activity } from '~/lib/activity';
import { aggregateMetric } from '~/lib/activity-presentation';
import { type DateFormat, formatPreferredDate } from '~/lib/date-preferences';
import { formatLocalDate } from '~/lib/local-date-time';
import { numberFormatter } from '~/lib/presentation/formatters';
import { semanticMetric } from '~/lib/presentation/icons';
import { type UnitSystem, formatMeasurement } from '~/lib/units';

function decFormatter(unit = '', decimals = 0) {
  return (num: number | undefined, locale = 'en') =>
    num == undefined || !Number.isFinite(num)
      ? '—'
      : numberFormatter(locale, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(num) + (unit ? ' ' + unit : '');
}

function durationFormatter(
  seconds: number,
  _units?: UnitSystem,
  _dateFormat?: DateFormat,
  locale = 'en',
) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const part = (value: number, unit: string, pad = false) =>
    numberFormatter(locale, {
      style: 'unit',
      unit,
      unitDisplay: 'narrow',
      ...(pad ? { minimumIntegerDigits: 2 } : {}),
    }).format(value);
  if (days > 99) {
    return part(days, 'day');
  } else if (days > 0) {
    return `${part(days, 'day')} ${part(hours, 'hour')}`;
  } else {
    return `${part(hours, 'hour')} ${part(minutes, 'minute', true)}`;
  }
}

export type ActivityValueType = number | string | Date | boolean;

export type ActivityField<K> = {
  formatter: (
    value: K,
    units?: UnitSystem,
    dateFormat?: DateFormat,
    locale?: string,
  ) => string;
  accessorFn?: (activity: Activity) => K;
  Icon?: ComponentType<{ className?: string }>;
  title: string;
  reducer?: (values: K[]) => K | null;
  reducerSymbol?: string;
  summary?: (values: K[], locale?: string) => string;
};

export const activityFields = {
  distance: {
    formatter: (
      value: number,
      units: UnitSystem = 'metric',
      _dateFormat: DateFormat = 'system',
      locale = 'en',
    ) => formatMeasurement(value, 'distance', units, locale),
    Icon: semanticMetric('distance').Icon,
    title: semanticMetric('distance').label,
    reducer: (values: number[]) => aggregateMetric(values, 'sum').value,
  },
  moving_time: {
    formatter: durationFormatter,
    Icon: semanticMetric('moving_time').Icon,
    title: semanticMetric('moving_time').label,
    reducer: (values: number[]) => aggregateMetric(values, 'sum').value,
  },
  elapsed_time: {
    formatter: durationFormatter,
    Icon: semanticMetric('elapsed_time').Icon,
    title: semanticMetric('elapsed_time').label,
    reducer: (values: number[]) => aggregateMetric(values, 'sum').value,
  },
  total_elevation_gain: {
    formatter: (
      v: number,
      units: UnitSystem = 'metric',
      _dateFormat: DateFormat = 'system',
      locale = 'en',
    ) => formatMeasurement(v, 'elevation', units, locale),
    Icon: semanticMetric('total_elevation_gain').Icon,
    title: semanticMetric('total_elevation_gain').label,
    reducer: (values: number[]) => aggregateMetric(values, 'sum').value,
  },
  elev_high: {
    formatter: (
      v: number,
      units: UnitSystem = 'metric',
      _dateFormat: DateFormat = 'system',
      locale = 'en',
    ) => formatMeasurement(v, 'elevation', units, locale),
    Icon: semanticMetric('elev_high').Icon,
    title: semanticMetric('elev_high').label,
    reducer: (values: number[]) => aggregateMetric(values, 'max').value,
    reducerSymbol: '≤',
  },
  elev_low: {
    formatter: (
      v: number,
      units: UnitSystem = 'metric',
      _dateFormat: DateFormat = 'system',
      locale = 'en',
    ) => formatMeasurement(v, 'elevation', units, locale),
    Icon: semanticMetric('elev_low').Icon,
    title: semanticMetric('elev_low').label,
    reducer: (values: number[]) => aggregateMetric(values, 'min').value,
    reducerSymbol: '≥',
  },
  date: {
    accessorFn: (act: Activity) => act.start_date_local,
    formatter: (
      date: Date,
      _units: UnitSystem = 'metric',
      dateFormat: DateFormat = 'system',
      locale = 'en',
    ) => (date == null ? '—' : formatPreferredDate(date, dateFormat, locale)),
    Icon: semanticMetric('date').Icon,
    title: semanticMetric('date').label,
    summary: (v: Date[], locale = 'en') => {
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
              locale,
            ),
          ),
      );
      return numberFormatter(locale, {
        style: 'unit',
        unit: 'day',
        unitDisplay: 'narrow',
      }).format(dates.size);
    },
  },
  average_speed: {
    formatter: (
      v: number,
      units: UnitSystem = 'metric',
      _dateFormat: DateFormat = 'system',
      locale = 'en',
    ) => formatMeasurement(v, 'speed', units, locale),
    Icon: semanticMetric('average_speed').Icon,
    title: semanticMetric('average_speed').label,
    reducer: (values: number[]) => aggregateMetric(values, 'mean').value,
    reducerSymbol: '∅',
  },
  weighted_average_watts: {
    formatter: (
      v: number,
      _units?: UnitSystem,
      _dateFormat?: DateFormat,
      locale = 'en',
    ) => decFormatter('W', 0)(v, locale),
    Icon: semanticMetric('weighted_average_watts').Icon,
    title: semanticMetric('weighted_average_watts').label,
    reducer: (values: number[]) => aggregateMetric(values, 'mean').value,
    reducerSymbol: '∅',
  },
  average_watts: {
    formatter: (
      v: number,
      _units?: UnitSystem,
      _dateFormat?: DateFormat,
      locale = 'en',
    ) => decFormatter('W', 0)(v, locale),
    Icon: semanticMetric('average_watts').Icon,
    title: semanticMetric('average_watts').label,
    reducer: (values: number[]) => aggregateMetric(values, 'mean').value,
    reducerSymbol: '∅',
  },
  max_watts: {
    formatter: (
      v: number,
      _units?: UnitSystem,
      _dateFormat?: DateFormat,
      locale = 'en',
    ) => decFormatter('W', 0)(v, locale),
    Icon: semanticMetric('max_watts').Icon,
    title: semanticMetric('max_watts').label,
    reducer: (values: number[]) => aggregateMetric(values, 'max').value,
    reducerSymbol: '≤',
  },
  max_heartrate: {
    formatter: (
      v: number,
      _units?: UnitSystem,
      _dateFormat?: DateFormat,
      locale = 'en',
    ) => decFormatter('bpm', 0)(v, locale),
    Icon: semanticMetric('max_heartrate').Icon,
    title: semanticMetric('max_heartrate').label,
    reducer: (values: number[]) => aggregateMetric(values, 'max').value,
    reducerSymbol: '≤',
  },
  average_heartrate: {
    formatter: (
      v: number,
      _units?: UnitSystem,
      _dateFormat?: DateFormat,
      locale = 'en',
    ) => decFormatter('bpm', 0)(v, locale),
    Icon: semanticMetric('average_heartrate').Icon,
    title: semanticMetric('average_heartrate').label,
    reducer: (values: number[]) => aggregateMetric(values, 'mean').value,
    reducerSymbol: '∅',
  },
} as const;
