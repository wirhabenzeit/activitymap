import * as d3 from 'd3';

import { defineChart, dot, crosshair } from '@tanstack/charts';
import { tooltip } from '@tanstack/charts/tooltip';
import { keyedSelection } from '@tanstack/charts/selection';
import { controlledSignal } from '@tanstack/charts/interaction/signal';
import * as React from 'react';

import { type Activity } from '~/server/db/schema';
import { categorySettings, aliasMap } from '~/settings/category';
import { resolveChartCategoryColors } from './chart-colors';

import { prepend } from './index';

const valueOptions = {
  distance: {
    id: 'distance',
    fun: (d: Activity) => d.distance! / 1000,
    format: (v: number) => v.toFixed() + 'km',
    tickFormat: (v: number) => v.toFixed(),
    label: 'Distance (km)',
    unit: 'km',
  },
  elevation: {
    id: 'elevation',
    fun: (d: Activity) => d.total_elevation_gain!,
    format: (v: number) => (v / 1.0).toFixed() + 'm',
    tickFormat: (v: number) => (v / 1.0).toFixed(),
    label: 'Elevation (m)',
    unit: 'm',
  },
  duration: {
    id: 'duration',
    fun: (d: Activity) => d.elapsed_time! / 3600,
    format: (v: number) => v.toFixed(1) + 'h',
    tickFormat: (v: number) => v.toFixed(0),
    label: 'Duration (h)',
    unit: 'h',
  },
  date: {
    id: 'date',
    fun: (d: Activity) => d.start_date_local,
    tickFormatShort: d3.timeFormat("'%y"),
    format: d3.timeFormat('%Y/%m'),
    tickFormat: d3.timeFormat('%Y/%m'),
    label: 'Date',
    unit: '',
  },
  average_speed: {
    id: 'average_speed',
    fun: (d: Activity) => (d.average_speed ?? 0) * 3.6,
    format: (v: number) => v.toFixed(1) + 'km/h',
    tickFormat: (v: number) => v.toFixed(1),
    label: 'Avg Speed (km/h)',
    unit: 'km/h',
  },
} as const;

export const settings = {
  xValue: {
    type: 'categorical',
    label: 'X',
    options: valueOptions,
  },
  yValue: {
    type: 'categorical',
    label: 'Y',
    options: valueOptions,
  },
  rValue: {
    type: 'categorical',
    label: 'R',
    options: valueOptions,
  },
  group: {
    type: 'categorical',
    label: 'Group',
    options: {
      sport_group: {
        id: 'sport_group',
        fun: (d: Activity) => aliasMap[d.sport_type]!,
        icon: (id: keyof typeof categorySettings) => categorySettings[id].icon,
        label: 'Group',
      },
    },
  },
} as const;

type ScatterSetting = {
  xValue: keyof typeof valueOptions;
  yValue: keyof typeof valueOptions;
  rValue: keyof typeof valueOptions;
  group: keyof typeof settings.group.options;
};

export const defaultSettings: ScatterSetting = {
  xValue: 'date',
  yValue: 'elevation',
  rValue: 'duration',
  group: 'sport_group',
};

type Spec = {
  xValue: (typeof valueOptions)[keyof typeof valueOptions];
  yValue: (typeof valueOptions)[keyof typeof valueOptions];
  rValue: (typeof valueOptions)[keyof typeof valueOptions];
  group: (typeof settings.group.options)[keyof typeof settings.group.options];
};

const getter = (setting: ScatterSetting): Spec => ({
  xValue: valueOptions[setting.xValue],
  yValue: valueOptions[setting.yValue],
  rValue: valueOptions[setting.rValue],
  group: settings.group.options[setting.group],
});

const setter =
  (scatter: ScatterSetting) =>
    <K extends keyof ScatterSetting>(name: K, value: ScatterSetting[K]) => {
      return { ...scatter, [name]: value };
    };

type ScatterRow = {
  id: number;
  x: number | Date;
  y: number | Date;
  r: number;
  group: keyof typeof categorySettings;
  name: string;
};

const buildRows = (activities: Activity[], setting: ScatterSetting): ScatterRow[] => {
  const { xValue, yValue, rValue, group } = getter(setting);
  return activities.map((act) => ({
    id: act.id,
    x: xValue.fun(act),
    y: yValue.fun(act),
    r: Number(rValue.fun(act)),
    group: group.fun(act),
    name: act.name,
  }));
};

export const chart =
  (setting: ScatterSetting) =>
    ({
      activities,
      width,
      selected,
      setSelected,
    }: {
      activities: Activity[];
      width: number;
      height: number;
      theme: 'light' | 'dark';
      selected: number[];
      setSelected: (ids: number[]) => void;
    }) => {
      const bigPlot = width > 500;
      const { xValue, yValue, rValue } = getter(setting);
      const data = buildRows(activities, setting);
      if (data.length === 0) return null;

      const selectedIds = new Set(selected);
      const hasSelection = selectedIds.size > 0;
      const selectedData = data.filter((d) => selectedIds.has(d.id));

      // Click selects a single activity; the store's `selected` can also
      // hold a multi-select made elsewhere (e.g. the list), which the
      // highlight layer above already reflects regardless of this key.
      const selectedKey = selectedIds.size === 1 ? [...selectedIds][0]! : null;
      const selection = keyedSelection<ScatterRow, number>({
        selected: controlledSignal(selectedKey, (next) => {
          setSelected(next === null ? [] : [next]);
        }),
        key: (datum) => datum.id,
      });

      const yTickFormatter = (value: Date | number) =>
        'tickFormatShort' in yValue
          ? yValue.tickFormatShort(value as Date)
          : yValue.tickFormat(value as number);
      const xTickFormatter = (value: Date | number) =>
        'tickFormatShort' in xValue
          ? xValue.tickFormatShort(value as Date)
          : xValue.tickFormat(value as number);

      const rExtent = d3.extent(data, (d) => d.r) as [number, number];
      const rScale = d3.scaleSqrt().domain(rExtent).range([2, 12]);

      const groupExtent = Array.from(new Set(data.map((d) => d.group)));
      const colors = resolveChartCategoryColors();

      const isDateAxis = (value: (typeof valueOptions)[keyof typeof valueOptions]) =>
        value.id === 'date';

      return defineChart({
        marks: [
          dot(data, {
            x: 'x',
            y: 'y',
            r: 'r',
            rScale,
            color: 'group',
            key: 'id',
            fillOpacity: hasSelection ? 0.15 : 0.7,
            strokeOpacity: 0,
          }),
          ...(hasSelection
            ? [
                dot(selectedData, {
                  x: 'x',
                  y: 'y',
                  r: 'r',
                  rScale,
                  color: 'group',
                  fillOpacity: 1,
                  stroke: 'currentColor',
                  strokeWidth: 1.5,
                  strokeOpacity: 0.8,
                }),
              ]
            : []),
          crosshair({ marker: true }),
        ],
        selection,
        scales: {
          x: {
            scale: isDateAxis(xValue) ? d3.scaleUtc : d3.scaleLinear,
            nice: true,
            axis: {
              ticks: {
                size: 12,
                format: bigPlot ? xTickFormatter : prepend(' ', xTickFormatter),
              },
              tickLabels: bigPlot ? undefined : { rotate: -90, anchor: 'start' },
            },
          },
          y: {
            scale: isDateAxis(yValue) ? d3.scaleUtc : d3.scaleLinear,
            nice: true,
            axis: {
              ticks: {
                size: 12,
                format: bigPlot ? yTickFormatter : prepend(' ', yTickFormatter),
              },
              tickLabels: bigPlot ? undefined : { rotate: -90, anchor: 'start' },
            },
          },
        },
        color: {
          domain: groupExtent,
          range: groupExtent.map((g) => colors[g]),
        },
        tooltip: {
          use: tooltip,
          items: [
            { field: 'name', label: 'Activity' },
            {
              id: 'r',
              label: rValue.label,
              text: (point) => rValue.format(point.datum.r as never),
            },
            {
              id: 'x',
              label: xValue.label,
              text: (point) => xValue.format(point.datum.x as never),
            },
            {
              id: 'y',
              label: yValue.label,
              text: (point) => yValue.format(point.datum.y as never),
            },
          ],
        },
      });
    };

export const Legend = ({
  setting,
  activities,
}: {
  setting: ScatterSetting;
  activities: Activity[];
  theme: 'light' | 'dark';
}) => {
  const { rValue } = getter(setting);
  const data = buildRows(activities, setting);
  if (data.length === 0) return null;

  if (rValue.id === 'date') return null;

  const rExtent = d3.extent(data, (d) => d.r) as [number, number];
  const rScale = d3.scaleSqrt().domain(rExtent).range([2, 12]);
  const ticks = rScale.ticks(4).filter((t) => t > 0);

  return React.createElement(
    'div',
    { className: 'flex items-center space-x-2 text-xs' },
    React.createElement('span', { className: 'font-semibold' }, rValue.label),
    ticks.map((t) =>
      React.createElement(
        'span',
        { key: t, className: 'flex items-center space-x-1' },
        React.createElement('span', {
          className: 'inline-block rounded-full border border-current',
          style: { width: rScale(t) * 2, height: rScale(t) * 2 },
        }),
        React.createElement('span', null, rValue.format(t)),
      ),
    ),
  );
};

const config = {
  chart,
  settings,
  defaultSettings,
  Legend,
  getter,
  setter,
};

export default config;
