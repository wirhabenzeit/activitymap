import type { Activity } from '~/server/db/schema';

import { defineChart, lineY, dot, crosshair, d3Curve } from '@tanstack/charts';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { tooltip } from '@tanstack/charts/tooltip';
import * as d3 from 'd3';
import * as React from 'react';

import { prepend } from './index';

type ProgressSetting = {
  value: keyof typeof settings.value.options;
  by: keyof typeof settings.by.options;
};

type Spec = {
  by: (typeof settings.by.options)[keyof typeof settings.by.options];
  value: (typeof settings.value.options)[keyof typeof settings.value.options];
};

const curveByName = {
  'step-after': d3.curveStepAfter,
  basis: d3.curveBasis,
} as const;

export const settings = {
  value: {
    type: 'categorical',
    label: 'Value',
    options: {
      count: {
        id: 'count',
        fun: () => 1,
        format: (v: number) => v.toFixed(),
        tickFormat: (v: number) => v.toFixed(),
        label: 'Count',
        unit: '',
      },
      distance: {
        id: 'distance',
        fun: (d: Activity) => (d.distance ?? 0) / 1000,
        tickFormat: (v: number) =>
          v >= 10_000
            ? (v / 1_000).toFixed() + 'k'
            : v < 10
              ? v.toFixed(1)
              : v.toFixed(),
        format: (v: number) => v.toFixed(1),
        label: 'Distance (km)',
      },
      elevation: {
        id: 'elevation',
        sortable: true,
        fun: (d: Activity) => Math.round(d.total_elevation_gain!),
        tickFormat: (v: number) =>
          v >= 10_000 ? (v / 1_000).toFixed() + 'k' : v.toFixed(),
        format: (v: number) => v.toFixed(),
        label: 'Elevation (m)',
      },
      time: {
        id: 'time',
        sortable: true,
        fun: (d: Activity) => Math.round(d.elapsed_time! / 360) / 10,
        format: (v: number) => {
          const hours = Math.floor(v);
          const minutes = Math.round((v - hours) * 60);
          return `${hours}h${minutes.toString().padStart(2, '0')}`;
        },
        tickFormat: (v: number) => v.toFixed(0),
        label: 'Duration (h)',
      },
    },
  },
  by: {
    type: 'categorical',
    label: 'By',
    options: {
      year: {
        id: 'year',
        label: 'Year',
        tick: d3.utcYear,
        legendFormat: d3.timeFormat('%Y'),
        tickFormat: d3.timeFormat('%b'),
        curve: 'step-after',
        dots: false,
        ticks: 'month',
        gridTicks: 'month',
        domain: [new Date('2024-01-01'), new Date('2024-12-31 23:59:59')],
      },
      month: {
        id: 'month',
        label: 'Month',
        tick: d3.utcMonth,
        legendFormat: d3.timeFormat('%b %Y'),
        tickFormat: d3.timeFormat('%d'),
        curve: 'basis',
        dots: true,
        gridTicks: 'day',
        ticks: 'week',
        domain: [new Date('2024-01-01'), new Date('2024-01-31 23:59:59')],
      },
      week: {
        id: 'week',
        label: 'Week',
        tick: d3.timeMonday,
        tickFormat: d3.timeFormat('%a'),
        curve: 'basis',
        dots: true,
        ticks: 'day',
        gridTicks: 'day',
        legendFormat: d3.timeFormat('%Y-%m-%d'),
        domain: [new Date('2024-01-01'), new Date('2024-01-07 23:59:59')],
      },
    },
  },
} as const;

export const defaultSettings: ProgressSetting = {
  by: 'month',
  value: 'elevation',
};

const getter = (setting: ProgressSetting): Spec => ({
  by: settings.by.options[setting.by],
  value: settings.value.options[setting.value],
});

const setter =
  (progress: ProgressSetting) =>
    <K extends keyof ProgressSetting>(name: K, value: ProgressSetting[K]) => {
      return { ...progress, [name]: value };
    };

type ProgressRow = {
  start_date_local: Date;
  by: Date;
  byKey: string;
  cumsum: number;
  virtualDate: Date;
  currentPeriod: boolean;
  name: string;
};

const buildRows = (activities: Activity[], setting: ProgressSetting): ProgressRow[] => {
  const { by, value } = getter(setting);

  const cumulative = d3
    .groups(activities, (x) => by.tick(new Date(x.start_date_local)))
    .flatMap(([dateKey, acts]): ProgressRow[] => {
      const sorted = acts
        .slice()
        .sort((a, b) => a.start_date_local.getTime() - b.start_date_local.getTime());
      if (sorted.length == 0) return [];
      const cumsum = d3.cumsum(sorted, value.fun);
      const firstDate = sorted[0]!.start_date_local;
      const toVirtualDate = (date: Date) =>
        new Date(
          new Date('2024-01-01').getTime() +
          date.getTime() -
          by.tick(date).getTime(),
        );
      return [
        {
          start_date_local: by.tick(firstDate),
          by: dateKey,
          byKey: dateKey.toISOString(),
          cumsum: 0,
          virtualDate: toVirtualDate(by.tick(firstDate)),
          currentPeriod: false,
          name: '',
        },
        ...sorted.map((act, i) => ({
          start_date_local: act.start_date_local,
          by: dateKey,
          byKey: dateKey.toISOString(),
          cumsum: cumsum[i]!,
          virtualDate: toVirtualDate(act.start_date_local),
          currentPeriod: false,
          name: act.name,
        })),
      ];
    });

  const keys = Array.from(new d3.InternSet(cumulative.map((x) => x.by)))
    .sort((a, b) => a.getTime() - b.getTime())
    .slice(-5);
  const keyTimes = new Set(keys.map((k) => k.getTime()));
  const lastKeyTime = keys[keys.length - 1]?.getTime();

  return cumulative
    .filter((x) => keyTimes.has(x.by.getTime()))
    .map((x) => ({ ...x, currentPeriod: x.by.getTime() === lastKeyTime }));
};

export const chart =
  (setting: ProgressSetting) =>
    ({
      activities,
      width,
    }: {
      activities: Activity[];
      width: number;
      height: number;
      theme: 'light' | 'dark';
    }) => {
      const { by, value } = getter(setting);
      const bigPlot = width > 500;
      const data = buildRows(activities, setting);
      if (data.length === 0) return null;

      const byKeys = Array.from(new Set(data.map((d) => d.byKey)));
      const colorRange = d3
        .quantize(d3.interpolateViridis, Math.max(byKeys.length, 2))
        .reverse();

      const formatByTick = bigPlot
        ? by.tickFormat
        : prepend(' ', by.tickFormat);
      const formatValueTick = bigPlot
        ? value.tickFormat
        : prepend(' ', value.tickFormat);

      const curve = d3Curve(curveByName[by.curve]);
      const pastRows = data.filter((d) => !d.currentPeriod);
      const currentRows = data.filter((d) => d.currentPeriod);

      return defineChart({
        marks: [
          ...(by.dots
            ? [
              dot(pastRows, {
                x: 'virtualDate',
                y: 'cumsum',
                z: 'byKey',
                color: 'byKey',
                r: 2,
                fillOpacity: 0.5,
              }),
            ]
            : []),
          lineY(pastRows, {
            x: 'virtualDate',
            y: 'cumsum',
            z: 'byKey',
            color: 'byKey',
            curve,
            strokeWidth: 2,
            strokeOpacity: 0.6,
          }),
          lineY(currentRows, {
            x: 'virtualDate',
            y: 'cumsum',
            z: 'byKey',
            color: 'byKey',
            curve,
            strokeWidth: 4,
            strokeOpacity: 0.9,
          }),
          dot(currentRows, {
            x: 'virtualDate',
            y: 'cumsum',
            z: 'byKey',
            color: 'byKey',
            r: 3,
            fillOpacity: 1,
          }),
          crosshair({ marker: true }),
        ],
        scales: {
          x: {
            scale: d3.scaleUtc().domain(by.domain),
            axis: {
              ticks: { size: 12, format: formatByTick },
              tickLabels: bigPlot
                ? undefined
                : { rotate: -90, anchor: 'start' },
            },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            axis: {
              ticks: { format: formatValueTick },
              tickLabels: bigPlot ? undefined : { rotate: -90, anchor: 'start' },
            },
          },
        },
        color: {
          domain: byKeys,
          range: colorRange,
        },
        tooltip: {
          use: tooltip,
          items: [
            // A `group` item both renders a formatted "Period" row and
            // suppresses the library's default tooltip title, which
            // otherwise falls back to the raw, unformatted group key
            // (the ISO date string backing `byKey`).
            {
              channel: 'group',
              label: 'Period',
              text: (point) =>
                by.legendFormat(new Date(point.group as string)),
            },
            {
              field: 'start_date_local',
              label: 'Date',
              text: (point) => d3.timeFormat('%Y-%m-%d')(point.datum.start_date_local),
            },
            { field: 'name', label: 'Name' },
            {
              id: 'value',
              label: value.label,
              text: (point) => value.format(point.datum.cumsum),
            },
          ],
        },
      });
    };

export const Legend = ({
  setting,
  activities,
}: {
  setting: ProgressSetting;
  activities: Activity[];
  theme: 'light' | 'dark';
}) => {
  const { by } = getter(setting);
  const data = buildRows(activities, setting);
  const byKeys = Array.from(new Set(data.map((d) => d.by.getTime()))).sort((a, b) => a - b);
  const colors = d3.quantize(d3.interpolateViridis, Math.max(byKeys.length, 2)).reverse();

  return React.createElement(
    'div',
    { className: 'flex items-center space-x-2 text-xs' },
    byKeys.map((time, i) =>
      React.createElement(
        'span',
        { key: time, className: 'flex items-center space-x-1' },
        React.createElement('span', {
          className: 'inline-block h-2 w-2 rounded-full',
          style: { backgroundColor: colors[i] },
        }),
        React.createElement('span', null, by.legendFormat(new Date(time))),
      ),
    ),
  );
};

const config = {
  settings,
  defaultSettings,
  chart,
  Legend,
  getter,
  setter,
};

export default config;
