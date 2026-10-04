import { type UnitSystem, METRES_PER_MILE, METRES_PER_FOOT } from '~/lib/units';
import { type StatsMetric } from '~/settings/stats-tiles.generated';

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const metricUnit: Record<StatsMetric, string> = {
  count: 'activities',
  distance: 'km',
  elevation: 'm',
  time: 'h',
};

export const metricLabel: Record<StatsMetric, string> = {
  count: 'Activities',
  distance: 'Distance',
  elevation: 'Elevation',
  time: 'Moving time',
};

export function formatMetric(value: number, metric: StatsMetric): string {
  return metric === 'time' && value < 10
    ? oneDecimal.format(value)
    : whole.format(value);
}

// Hilliness is displayed in metres climbed per kilometre, with one decimal.
export const formatHilliness = (metersPerKm: number) =>
  oneDecimal.format(metersPerKm);

export const formatDailyRate = (value: number) =>
  value !== 0 && Math.abs(value) < 1
    ? new Intl.NumberFormat('en-US', { maximumSignificantDigits: 2 }).format(
        value,
      )
    : oneDecimal.format(value);

export function formatWithUnit(value: number, metric: StatsMetric): string {
  return `${formatMetric(value, metric)} ${metricUnit[metric]}`;
}

export function formatShort(value: number): string {
  if (Math.abs(value) >= 10_000) return `${whole.format(value / 1000)}k`;
  if (Math.abs(value) >= 1000)
    return `${oneDecimal.format(value / 1000).replace(/\.0$/, '')}k`;
  return whole.format(value);
}

export function percentChange(current: number, previous: number) {
  if (previous === 0) return null;
  return Math.round((current / previous - 1) * 100);
}

const monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function monthName(date: Date) {
  return monthNames[date.getUTCMonth()]!;
}

export function shortDate(date: Date) {
  return `${monthName(date)} ${date.getUTCDate()}`;
}

export type TilePalette = {
  foreground: string;
  muted: string;
  faint: string;
  bar: string;
  empty: string;
  heat: string;
};

export function tilePalette(dark: boolean): TilePalette {
  return dark
    ? {
        foreground: '#f2f2f0',
        muted: '#9e9e9b',
        faint: '#4a4a48',
        bar: '#3d3d3b',
        empty: '#262625',
        heat: '#ff6a4d',
      }
    : {
        foreground: '#151515',
        muted: '#6b6b69',
        faint: '#cfcfcc',
        bar: '#cfcfcc',
        empty: '#ededeb',
        heat: '#e0452e',
      };
}

/** Stats calculations use kilometres/metres/hours. Keep that contract unchanged. */
export function statsFormat(units: UnitSystem = 'metric') {
  const convert = (value: number, metric: StatsMetric) =>
    units === 'metric'
      ? value
      : metric === 'distance'
        ? (value * 1000) / METRES_PER_MILE
        : metric === 'elevation'
          ? value / METRES_PER_FOOT
          : value;
  const unit = {
    ...metricUnit,
    distance: units === 'imperial' ? 'mi' : 'km',
    elevation: units === 'imperial' ? 'ft' : 'm',
  };
  return {
    metricUnit: unit,
    formatMetric: (value: number, metric: StatsMetric) =>
      formatMetric(convert(value, metric), metric),
    formatWithUnit: (value: number, metric: StatsMetric) =>
      `${formatMetric(convert(value, metric), metric)} ${unit[metric]}`,
    formatDailyRate: (value: number, metric: StatsMetric = 'count') =>
      formatDailyRate(convert(value, metric)),
    formatHilliness: (value: number) =>
      formatHilliness(
        units === 'metric'
          ? value
          : (value * METRES_PER_MILE) / 1000 / METRES_PER_FOOT,
      ),
    hillinessUnit: units === 'imperial' ? 'ft / mi' : 'm / km',
  };
}
