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
  time: 'Time',
};

export function formatMetric(value: number, metric: StatsMetric): string {
  return metric === 'time' && value < 10
    ? oneDecimal.format(value)
    : whole.format(value);
}

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
