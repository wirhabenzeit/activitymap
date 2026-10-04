'use client';

// Small TanStack Charts builders shared by the tile faces (no axes or grid)
// and the detail views (with axes). Both have hover tooltips.

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import * as d3 from 'd3';
import {
  areaY,
  barY,
  defineChart,
  dot,
  lineY,
  ruleY,
  stack,
  text,
  crosshair,
} from '@tanstack/charts';
import { tooltip } from '@tanstack/charts/tooltip';
import { portal } from '@tanstack/charts/tooltip/portal';
import { Chart } from '@tanstack/charts/react';

import { type ComparisonBand } from '~/lib/stats/comparison-band';
import { categorySettings } from '~/settings/category';
import { sportOrder, type Sport } from '~/lib/stats/tile-data';
import { dateOfDay, volumeDomain } from '~/lib/stats/tile-series';

import { formatShort, type TilePalette } from './format';

export function Measure({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((previous) =>
        previous.width === Math.floor(width) &&
        previous.height === Math.floor(height)
          ? previous
          : { width: Math.floor(width), height: Math.floor(height) },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={style}>
      {size.width > 0 && size.height > 0 && children(size)}
    </div>
  );
}

const sportColors = sportOrder.map((sport) => categorySettings[sport].color);
const sportName = (sport: Sport) => categorySettings[sport].name;

export type LineSeries = {
  key: string;
  label: string;
  points: { x: number; y: number }[];
  current: boolean;
};

export function CumulativeLines({
  series,
  band,
  xMax,
  width,
  height,
  palette,
  detail,
  compact = false,
  monthAxisFrom,
  valueFormat,
  xLabel,
  endLabels = false,
}: {
  series: LineSeries[];
  band?: ComparisonBand;
  xMax: number;
  width: number;
  height: number;
  palette: TilePalette;
  detail: boolean;
  compact?: boolean;
  // Day number of x = 0; the detail axis then shows months.
  monthAxisFrom?: number;
  valueFormat: (y: number) => string;
  xLabel: (x: number) => string;
  // Name each line at its end, so no legend is needed.
  endLabels?: boolean;
}) {
  const toX = (x: number) =>
    monthAxisFrom === undefined ? x : dateOfDay(monthAxisFrom + x);
  const rows = series.flatMap((s) =>
    s.points.map((point) => ({
      x: toX(point.x),
      day: point.x,
      y: point.y,
      key: s.key,
      label: s.label,
    })),
  );
  const past = rows.filter((row) => row.key !== currentKey(series));
  const current = rows.filter((row) => row.key === currentKey(series));
  const lastCurrent = current.at(-1);
  const keys = series.map((s) => s.key);
  const ends = endLabels
    ? series.flatMap((s) => {
        const last = rows.filter((row) => row.key === s.key).at(-1);
        return last ? [last] : [];
      })
    : [];

  const labelOverlap =
    ends.length === 2 &&
    Math.abs(ends[0]!.day - ends[1]!.day) / xMax < 0.13 &&
    Math.abs(ends[0]!.y - ends[1]!.y) /
      Math.max(1, ...rows.map((row) => row.y)) <
      0.13;
  const bandRows =
    band?.points.map((point) => ({
      ...point,
      x: toX(point.x),
      day: point.x,
    })) ?? [];
  // Plain wording on the face; the tooltip and title give the exact
  // 5th–95th percentile or min–max definition.
  const bandLabel = band
    ? band.kind === 'month'
      ? `Shaded: typical range of ${band.count} past months`
      : `Shaded: range of ${band.count} past years`
    : undefined;
  const definition = defineChart({
    marks: [
      areaY(bandRows, {
        x: 'x',
        y1: 'low',
        y2: 'high',
        fill: palette.muted,
        fillOpacity: 0.13,
      }),
      lineY(past, {
        x: 'x',
        y: 'y',
        z: 'key',
        color: 'key',
        strokeWidth: detail ? 1.5 : 1.25,
        strokeDasharray: '4 3',
      }),
      lineY(current, {
        x: 'x',
        y: 'y',
        z: 'key',
        color: 'key',
        strokeWidth: detail ? 2.5 : 2,
      }),
      dot(lastCurrent ? [lastCurrent] : [], {
        x: 'x',
        y: 'y',
        color: 'key',
        r: 3.5,
      }),
      text(ends, {
        x: 'x',
        y: 'y',
        text: 'label',
        color: 'key',
        anchor: 'start',
        dx: 6,
        dy: (row) =>
          labelOverlap ? (row.key === currentKey(series) ? -6 : 9) : 3,
        fontSize: 10,
        fontWeight: 500,
      }),
      crosshair({ marker: true }),
    ],
    guides: detail || compact,
    margin: { top: 12, right: endLabels ? 36 : 8, bottom: 22, left: 32 },
    scales: {
      x: {
        scale:
          monthAxisFrom === undefined
            ? d3.scaleLinear().domain([0, xMax])
            : d3.scaleUtc().domain([toX(0), toX(xMax)]),
        axis:
          detail || compact
            ? {
                ticks: {
                  values:
                    monthAxisFrom === undefined
                      ? [1, 8, 15, 22, 29]
                      : [0, 3, 6, 9].map(
                          (month) =>
                            new Date(
                              Date.UTC(
                                dateOfDay(monthAxisFrom).getUTCFullYear(),
                                month,
                                1,
                              ),
                            ),
                        ),
                  format: (x: number | Date) =>
                    x instanceof Date ? d3.utcFormat('%b')(x) : String(x),
                },
              }
            : false,
      },
      y: {
        scale: d3
          .scaleLinear()
          .domain([
            0,
            Math.max(
              1,
              ...rows.map((row) => row.y),
              ...bandRows.map((row) => row.high),
            ) * 1.08,
          ]),
        axis:
          detail || compact
            ? { ticks: { count: detail ? 5 : 3, format: formatShort } }
            : false,
      },
    },
    color: {
      domain: keys,
      range: series.map((s, index) =>
        s.current
          ? palette.foreground
          : d3.interpolateRgb(
              palette.faint,
              palette.muted,
            )(series.length > 2 ? index / (series.length - 2) : 1),
      ),
    },
    tooltip: {
      use: tooltip,
      // Tiles clip their content; render the tooltip outside them.
      portal,
      items: [
        ...(band
          ? [
              {
                id: 'history',
                label:
                  band.kind === 'month'
                    ? 'Historical 5th–95th percentile'
                    : 'Historical min–max',
                text: (point: { datum: { day: number } }) => {
                  const range = band.points.find(
                    (row) => row.x === point.datum.day,
                  );
                  return range
                    ? `${valueFormat(range.low)}–${valueFormat(range.high)} (${range.count} ${band.kind === 'month' ? 'months' : 'years'})`
                    : 'Not enough history for this day';
                },
              },
            ]
          : []),
        {
          channel: 'group',
          label: '',
          text: (point) =>
            'label' in point.datum ? point.datum.label : 'Historical range',
        },
        {
          id: 'x',
          label: 'Date',
          text: (point) => xLabel(point.datum.day),
        },
        {
          id: 'y',
          label: 'Total',
          text: (point) =>
            !('y' in point.datum)
              ? `${valueFormat(point.datum.low)}–${valueFormat(point.datum.high)}`
              : valueFormat(point.datum.y),
        },
      ],
    },
  });

  return (
    <div>
      <Chart
        definition={definition}
        width={width}
        height={height - 20}
        ariaLabel={`Cumulative totals${bandLabel ? `; ${bandLabel}` : ''}`}
      />
      <p
        className="mt-1 text-[10px] leading-4 text-muted-foreground"
        title={
          band
            ? `Completed history: ${dateOfDay(band.first).toISOString().slice(0, 10)} to ${dateOfDay(band.last).toISOString().slice(0, 10)}. Current period excluded.`
            : undefined
        }
      >
        {bandLabel ?? 'Historical band needs 2 completed periods'}
      </p>
    </div>
  );
}

function currentKey(series: LineSeries[]) {
  return series.find((s) => s.current)?.key;
}

// Weekly totals as a filled area, with a dashed tail into the current,
// partial week and an optional rolling-average line.
export type WeekPoint = { x: Date; value: number };

export function VolumeArea({
  weeks,
  trend = [],
  trendLabel = '',
  detail = false,
  compact = false,
  width,
  height,
  palette,
  valueFormat,
}: {
  weeks: WeekPoint[];
  trend?: WeekPoint[];
  // Named at the trend line's start, away from the partial week.
  trendLabel?: string;
  // Axes, for the expanded tile.
  detail?: boolean;
  compact?: boolean;
  width: number;
  height: number;
  palette: TilePalette;
  valueFormat: (value: number) => string;
}) {
  const full = weeks.slice(0, -1);
  const tail = weeks.slice(-2);
  // A trend line, not bars: the scale hugs the data so week-to-week change
  // is visible in a short tile, and the area fills down to the scale's floor.
  const [dataFloor, ceiling] = volumeDomain(
    [...weeks, ...trend].map((week) => week.value),
  );
  const floor = compact ? 0 : dataFloor;
  const definition = defineChart({
    marks: [
      areaY(full, {
        x: 'x',
        y: 'value',
        y1: floor,
        fill: palette.foreground,
        fillOpacity: 0.08,
      }),
      lineY(full, {
        x: 'x',
        y: 'value',
        stroke: palette.foreground,
        strokeWidth: 2,
      }),
      areaY(tail, {
        x: 'x',
        y: 'value',
        y1: floor,
        fill: palette.foreground,
        fillOpacity: 0.03,
      }),
      lineY(tail, {
        x: 'x',
        y: 'value',
        stroke: palette.muted,
        strokeWidth: 1.5,
        strokeDasharray: '3 3',
      }),
      lineY(trend, {
        x: 'x',
        y: 'value',
        stroke: compact ? palette.muted : palette.heat,
        strokeDasharray: compact ? '4 3' : undefined,
        strokeWidth: 1.5,
      }),
      text(trend.slice(0, 1), {
        x: 'x',
        y: compact ? () => ceiling : 'value',
        text: () => trendLabel,
        fill: compact ? palette.muted : palette.heat,
        anchor: 'start',
        dy: -6,
        fontSize: 10,
        fontWeight: 500,
      }),
      dot(weeks.slice(-1), {
        x: 'x',
        y: 'value',
        fill: palette.muted,
        r: 3,
      }),
      crosshair({ marker: true }),
    ],
    guides: detail || compact,
    margin: compact
      ? { top: 12, right: 8, bottom: 22, left: 30 }
      : detail
        ? { top: 16 }
        : { top: 16, right: 6, bottom: 2, left: 2 },
    scales: {
      x: {
        scale: d3
          .scaleUtc()
          .domain([weeks[0]?.x ?? new Date(0), weeks.at(-1)?.x ?? new Date(0)]),
        axis:
          detail || compact
            ? {
                ticks: {
                  count: 3,
                  format: (x: Date) => d3.utcFormat('%b %-d')(x),
                },
              }
            : false,
      },
      y: {
        scale: d3.scaleLinear().domain([floor, ceiling]),
        axis:
          detail || compact
            ? { ticks: { count: 3, format: formatShort } }
            : false,
      },
    },
    tooltip: {
      use: tooltip,
      portal,
      items: [
        {
          id: 'x',
          label: 'Week of',
          text: (point) => d3.utcFormat('%b %-d')(point.datum.x),
        },
        {
          id: 'value',
          label: 'Total',
          text: (point) => valueFormat(point.datum.value),
        },
      ],
    },
  });
  return (
    <Chart
      definition={definition}
      width={width}
      height={height}
      ariaLabel="Weekly totals"
    />
  );
}

export type SportBar = { x: string; sport: Sport; value: number };

export function SportBars({
  rows,
  width,
  height,
  detail,
  average,
  partialLast = false,
  shape = 'bars',
  trend = [],
  trendLabel = '4-week average',
  palette,
  valueFormat,
  xTickFormat,
}: {
  rows: SportBar[];
  width: number;
  height: number;
  detail: boolean;
  average?: number;
  // Fade the last bar, a period that is not over yet.
  partialLast?: boolean;
  shape?: 'area' | 'bars';
  // A line over the bars, such as a rolling average.
  trend?: { x: string; value: number }[];
  trendLabel?: string;
  palette: TilePalette;
  valueFormat: (value: number) => string;
  xTickFormat?: (x: string) => string;
}) {
  const xs = Array.from(new Set(rows.map((row) => row.x)));
  const partialX = partialLast ? xs.at(-1) : undefined;
  const bars = (source: SportBar[], fillOpacity: number) =>
    barY(source, {
      x: 'x',
      y: 'value',
      color: 'sport',
      layout: stack({ order: [...sportOrder] }),
      inset: 1,
      fillOpacity,
    });
  const totals = xs.map((x) => ({
    x,
    value: rows
      .filter((row) => row.x === x)
      .reduce((sum, row) => sum + row.value, 0),
    kind: 'Total',
  }));
  const area = (source: SportBar[], fillOpacity: number) =>
    areaY(source, {
      x: 'x',
      y: 'value',
      z: 'sport',
      color: 'sport',
      fillOpacity,
      layout: stack({ order: [...sportOrder] }),
    });
  const tailXs = xs.slice(-2);
  const definition = defineChart({
    marks: [
      ...(shape === 'area'
        ? [
            ...(xs.length === 1
              ? [bars(rows, partialLast ? 0.3 : 0.8)]
              : partialLast
                ? [
                    area(
                      rows.filter((row) => row.x !== partialX),
                      0.8,
                    ),
                    area(
                      rows.filter((row) => tailXs.includes(row.x)),
                      0.3,
                    ),
                  ]
                : [area(rows, 0.8)]),
            lineY(partialLast ? totals.slice(0, -1) : totals, {
              x: 'x',
              y: 'value',
              stroke: palette.foreground,
              strokeWidth: 1,
            }),
            ...(partialLast
              ? [
                  lineY(totals.slice(-2), {
                    x: 'x',
                    y: 'value',
                    stroke: palette.muted,
                    strokeWidth: 1,
                    strokeDasharray: '2 3',
                  }),
                ]
              : []),
          ]
        : [
            bars(
              rows.filter((row) => row.x !== partialX),
              1,
            ),
            bars(
              rows.filter((row) => row.x === partialX),
              0.4,
            ),
          ]),
      lineY(trend, {
        x: 'x',
        y: 'value',
        stroke: palette.foreground,
        strokeWidth: 1.5,
        strokeOpacity: 0.9,
        strokeDasharray: '4 3',
      }),
      ...(average !== undefined && detail
        ? [
            ruleY([average], {
              stroke: palette.muted,
              strokeDasharray: '4 3',
            }),
          ]
        : []),
    ],
    guides: detail,
    margin: detail ? undefined : { top: 2, right: 0, bottom: 0, left: 0 },
    scales: {
      x: {
        scale: d3.scaleBand<string>().domain(xs).padding(0.2),
        axis: detail
          ? { ticks: { format: xTickFormat ?? ((x: string) => x) } }
          : false,
      },
      y: {
        scale: d3.scaleLinear,
        nice: true,
        axis: detail ? { ticks: { format: formatShort } } : false,
      },
    },
    color: { domain: [...sportOrder], range: sportColors },
    tooltip: {
      use: tooltip,
      // Tiles clip their content; render the tooltip outside them.
      portal,
      items: [
        {
          channel: 'group',
          label: 'Sport',
          text: (point) =>
            'sport' in point.datum
              ? sportName(point.datum.sport)
              : 'kind' in point.datum
                ? String(point.datum.kind)
                : trendLabel,
        },
        {
          id: 'x',
          label: 'When',
          text: (point) =>
            `${(xTickFormat ?? ((x: string) => x))(point.datum.x)}${point.datum.x === partialX ? ' · incomplete' : ''}`,
        },
        {
          id: 'value',
          label: 'Value',
          text: (point) => valueFormat(point.datum.value),
        },
        {
          id: 'total',
          label: 'Period total',
          text: (point) =>
            valueFormat(
              rows
                .filter((row) => row.x === point.datum.x)
                .reduce((sum, row) => sum + row.value, 0),
            ),
        },
      ],
    },
  });
  return (
    <Chart
      definition={definition}
      width={width}
      height={height}
      ariaLabel="Totals by sport"
    />
  );
}

export type PlainBar = {
  x: string;
  value: number | null;
  highlight: boolean;
  partial?: boolean;
};

export function PlainBars({
  rows,
  width,
  height,
  detail,
  compact = false,
  average,
  palette,
  valueFormat,
  xTickFormat,
  xAxisFormat,
  yDomain,
  ariaLabel = 'Bars',
}: {
  rows: PlainBar[];
  width: number;
  height: number;
  detail: boolean;
  compact?: boolean;
  average?: number;
  palette: TilePalette;
  valueFormat: (value: number) => string;
  xTickFormat?: (x: string) => string;
  xAxisFormat?: (x: string) => string;
  yDomain?: [number, number];
  ariaLabel?: string;
}) {
  const definition = defineChart({
    marks: [
      barY(
        rows.filter((row) => row.value !== null),
        {
          x: 'x',
          y: 'value',
          color: (row) =>
            row.partial ? 'partial' : row.highlight ? 'current' : 'past',
          inset: 1,
        },
      ),
      ...(average !== undefined && detail
        ? [
            ruleY([average], {
              stroke: palette.muted,
              strokeDasharray: '4 3',
            }),
          ]
        : []),
    ],
    guides: detail || compact,
    margin: compact
      ? { top: 8, right: 4, bottom: 22, left: 30 }
      : detail
        ? undefined
        : { top: 2, right: 0, bottom: 0, left: 0 },
    scales: {
      x: {
        scale: d3
          .scaleBand<string>()
          .domain(rows.map((row) => row.x))
          .padding(0.2),
        axis:
          detail || compact
            ? {
                ticks: {
                  values: rows
                    .filter(
                      (_, index) =>
                        index %
                          Math.max(
                            1,
                            Math.ceil(rows.length / (detail ? 6 : 4)),
                          ) ===
                        0,
                    )
                    .map((row) => row.x),
                  format: xAxisFormat ?? xTickFormat ?? ((x: string) => x),
                },
              }
            : false,
      },
      y: {
        scale: yDomain
          ? d3.scaleLinear().domain(yDomain)
          : compact
            ? d3
                .scaleLinear()
                .domain([
                  0,
                  Math.max(1, ...rows.map((row) => row.value ?? 0)) * 1.08,
                ])
            : d3.scaleLinear,
        nice: !yDomain && !compact,
        axis:
          detail || compact
            ? {
                ticks: {
                  ...(yDomain
                    ? { values: yDomain }
                    : { count: compact ? 3 : undefined }),
                  format: formatShort,
                },
              }
            : false,
      },
    },
    color: {
      domain: ['current', 'past', 'partial'],
      range: [palette.foreground, palette.bar, palette.faint],
    },
    tooltip: {
      use: tooltip,
      // Tiles clip their content; render the tooltip outside them.
      portal,
      items: [
        {
          channel: 'group',
          label: '',
          text: (point) =>
            `${(xTickFormat ?? ((x: string) => x))(point.datum.x)}${point.datum.partial ? ' · current week, incomplete' : ''}`,
        },
        {
          id: 'value',
          label: 'Value',
          text: (point) =>
            point.datum.value === null
              ? 'Not yet elapsed'
              : valueFormat(point.datum.value),
        },
      ],
    },
  });
  return (
    <Chart
      definition={definition}
      width={width}
      height={height}
      ariaLabel={ariaLabel}
    />
  );
}
