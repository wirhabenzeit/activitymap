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

import { categorySettings } from '~/settings/category';
import { sportOrder, type Sport } from '~/lib/stats/tile-data';
import { dateOfDay } from '~/lib/stats/tile-series';

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
  xMax,
  width,
  height,
  palette,
  detail,
  monthAxisFrom,
  valueFormat,
  xLabel,
  endLabels = false,
}: {
  series: LineSeries[];
  xMax: number;
  width: number;
  height: number;
  palette: TilePalette;
  detail: boolean;
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

  const definition = defineChart({
    marks: [
      lineY(past, {
        x: 'x',
        y: 'y',
        z: 'key',
        color: 'key',
        strokeWidth: detail ? 1.5 : 1.25,
        strokeDasharray: detail ? undefined : '4 3',
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
        dy: 3,
        fontSize: 10,
        fontWeight: 500,
      }),
      crosshair({ marker: true }),
    ],
    guides: detail,
    margin: detail
      ? undefined
      : { top: 6, right: endLabels ? 34 : 4, bottom: 2, left: 2 },
    scales: {
      x: {
        scale:
          monthAxisFrom === undefined
            ? d3.scaleLinear().domain([0, xMax])
            : d3.scaleUtc().domain([toX(0), toX(xMax)]),
        axis: detail
          ? {
              ticks: {
                format: (x: number | Date) =>
                  x instanceof Date ? d3.utcFormat('%b')(x) : String(x),
              },
            }
          : false,
      },
      y: {
        scale: d3.scaleLinear,
        nice: true,
        axis: detail ? { ticks: { format: formatShort } } : false,
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
        {
          channel: 'group',
          label: '',
          text: (point) => String(point.datum.label),
        },
        {
          id: 'x',
          label: 'Date',
          text: (point) => xLabel(point.datum.day),
        },
        {
          id: 'y',
          label: 'Total',
          text: (point) => valueFormat(point.datum.y),
        },
      ],
    },
  });

  return (
    <Chart
      definition={definition}
      width={width}
      height={height}
      ariaLabel="Cumulative totals"
    />
  );
}

function currentKey(series: LineSeries[]) {
  return series.find((s) => s.current)?.key;
}

export type SportBar = { x: string; sport: Sport; value: number };

export function SportBars({
  rows,
  width,
  height,
  detail,
  average,
  partialLast = false,
  trend = [],
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
  // A line over the bars, such as a rolling average.
  trend?: { x: string; value: number }[];
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
  const definition = defineChart({
    marks: [
      bars(
        rows.filter((row) => row.x !== partialX),
        1,
      ),
      bars(
        rows.filter((row) => row.x === partialX),
        0.4,
      ),
      lineY(trend, {
        x: 'x',
        y: 'value',
        stroke: palette.foreground,
        strokeWidth: 1.5,
        strokeOpacity: 0.7,
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
              : 'Rolling average',
        },
        {
          id: 'x',
          label: 'When',
          text: (point) => (xTickFormat ?? ((x: string) => x))(point.datum.x),
        },
        {
          id: 'value',
          label: 'Value',
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
      ariaLabel="Totals by sport"
    />
  );
}

export type PlainBar = { x: string; value: number; highlight: boolean };

export function PlainBars({
  rows,
  width,
  height,
  detail,
  average,
  palette,
  valueFormat,
  xTickFormat,
}: {
  rows: PlainBar[];
  width: number;
  height: number;
  detail: boolean;
  average?: number;
  palette: TilePalette;
  valueFormat: (value: number) => string;
  xTickFormat?: (x: string) => string;
}) {
  const definition = defineChart({
    marks: [
      barY(rows, {
        x: 'x',
        y: 'value',
        color: (row) => (row.highlight ? 'current' : 'past'),
        inset: 1,
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
        scale: d3
          .scaleBand<string>()
          .domain(rows.map((row) => row.x))
          .padding(0.2),
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
    color: {
      domain: ['current', 'past'],
      range: [palette.foreground, palette.bar],
    },
    tooltip: {
      use: tooltip,
      // Tiles clip their content; render the tooltip outside them.
      portal,
      items: [
        {
          channel: 'group',
          label: '',
          text: (point) => (xTickFormat ?? ((x: string) => x))(point.datum.x),
        },
        {
          id: 'value',
          label: 'Value',
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
      ariaLabel="Bars"
    />
  );
}

export function DistanceElevationDots({
  points,
  width,
  height,
  detail,
}: {
  points: { distance: number; elevation: number; sport: Sport }[];
  width: number;
  height: number;
  detail: boolean;
}) {
  const definition = defineChart({
    marks: [
      dot(points, {
        x: 'distance',
        y: 'elevation',
        color: 'sport',
        r: detail ? 3 : 1.75,
        fillOpacity: 0.7,
        strokeOpacity: 0,
      }),
      crosshair({ marker: true }),
    ],
    guides: detail,
    margin: detail ? undefined : 3,
    scales: {
      x: {
        scale: d3.scaleLinear,
        nice: true,
        axis: detail ? { ticks: { format: formatShort } } : false,
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
          text: (point) => sportName(point.datum.sport),
        },
        {
          id: 'distance',
          label: 'Distance',
          text: (point) => `${point.datum.distance.toFixed(1)} km`,
        },
        {
          id: 'elevation',
          label: 'Elevation',
          text: (point) => `${Math.round(point.datum.elevation)} m`,
        },
      ],
    },
  });
  return (
    <Chart
      definition={definition}
      width={width}
      height={height}
      ariaLabel="Distance against elevation"
    />
  );
}
