import { dateFormatter, numberFormatter } from '~/lib/presentation/formatters';
import { comparisonPresentation } from '~/lib/stats/presentation-policy';
import { METRES_PER_FOOT, METRES_PER_MILE, type UnitSystem } from '~/lib/units';
import { type StatsMetric } from '~/settings/stats-tiles.generated';

const number = (locale = 'en', decimals = 0) =>
  numberFormatter(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
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

export function formatMetric(
  value: number,
  metric: StatsMetric,
  locale = 'en',
): string {
  return metric === 'time' && value < 10
    ? number(locale, 1).format(value)
    : number(locale).format(value);
}

// Hilliness is displayed in metres climbed per kilometre, with one decimal.
export const formatHilliness = (metersPerKm: number, locale = 'en') =>
  number(locale, 1).format(metersPerKm);

export const formatDailyRate = (value: number, locale = 'en') =>
  value !== 0 && Math.abs(value) < 1
    ? numberFormatter(locale, {
        maximumSignificantDigits: 2,
      }).format(value)
    : number(locale, 1).format(value);

export function formatWithUnit(
  value: number,
  metric: StatsMetric,
  locale = 'en',
): string {
  return `${formatMetric(value, metric, locale)} ${metricUnit[metric]}`;
}

/** Precision follows the spacing of displayed ticks, including after conversion. */
export function formatShort(value: number, step = 1, locale = 'en'): string {
  const scale = Math.abs(value) >= 1000 ? 1000 : 1;
  const interval = Math.abs(step) / scale;
  const decimals =
    Number.isFinite(interval) && interval > 0
      ? Math.min(12, Math.max(0, Math.ceil(-Math.log10(interval))))
      : 0;
  const factor = 10 ** decimals;
  const rounded =
    (Math.sign(value) * Math.floor(Math.abs(value / scale) * factor + 0.5)) /
    factor;
  return (
    numberFormatter(locale, {
      maximumFractionDigits: decimals,
    }).format(rounded === 0 ? 0 : rounded) + (scale === 1000 ? 'k' : '')
  );
}

export function axisTicks(
  values: number[],
  format: (value: number, step: number) => string = formatShort,
) {
  const gaps = values
    .slice(1)
    .map((value, index) => Math.abs(value - values[index]!))
    .filter((gap) => gap > 0);
  const step = gaps.length ? Math.min(...gaps) : 1;
  return { values, format: (value: number) => format(value, step) };
}

export function percentChange(current: number, previous: number) {
  const facts = comparisonPresentation(current, previous);
  if (facts.magnitude === null) return null;
  return facts.magnitude === 0
    ? 0
    : facts.direction === 'lower'
      ? -facts.magnitude
      : facts.magnitude;
}

/** Activity-local calendar coordinates stay in UTC; locale changes ordering only. */
export function monthName(date: Date, locale = 'en') {
  return dateFormatter(locale, {
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}
export function shortDate(date: Date, locale = 'en') {
  return dateFormatter(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
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
export function statsFormat(units: UnitSystem = 'metric', locale = 'en') {
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
      formatMetric(convert(value, metric), metric, locale),
    formatWithUnit: (value: number, metric: StatsMetric) =>
      `${formatMetric(convert(value, metric), metric, locale)} ${unit[metric]}`,
    formatShort: (value: number, metric: StatsMetric, step = 1) =>
      formatShort(convert(value, metric), convert(step, metric), locale),
    formatHillinessAxis: (value: number, step: number) => {
      const scale =
        units === 'metric' ? 1 : METRES_PER_MILE / 1000 / METRES_PER_FOOT;
      return formatShort(value * scale, step * scale, locale);
    },
    formatDailyRate: (value: number, metric: StatsMetric = 'count') =>
      formatDailyRate(convert(value, metric), locale),
    formatHilliness: (value: number) =>
      formatHilliness(
        units === 'metric'
          ? value
          : (value * METRES_PER_MILE) / 1000 / METRES_PER_FOOT,
        locale,
      ),
    hillinessUnit: units === 'imperial' ? 'ft / mi' : 'm / km',
  };
}
