import { defineChart, areaY, lineY, crosshair, ruleY, rollingWindow, d3Curve } from '@tanstack/charts';
import { tooltip } from '@tanstack/charts/tooltip';

import { ChartLine, ChartColumn } from 'lucide-react';
import * as d3 from 'd3';
import * as React from 'react';

import { type Activity } from '~/server/db/schema';
import { categorySettings, aliasMap } from '~/settings/category';
import { resolveChartCategoryColors } from './chart-colors';

import { prepend } from './index';

export const settings = {
  averaging: {
    type: 'number',
    label: 'Averaging',
    minIcon: <ChartColumn />,
    maxIcon: <ChartLine />,
  },
  value: {
    type: 'categorical',
    label: 'Value',
    options: {
      count: {
        id: 'count',
        fun: () => 1,
        sortable: false,
        format: (v: number) => v.toFixed(0),
        label: 'Count',
        unit: '',
      },
      distance: {
        id: 'distance',
        fun: (d: Activity) => d.distance,
        sortable: true,
        format: (v: number) =>
          v >= 10_000_000
            ? (v / 1_000_000).toFixed() + 'k'
            : (v / 1000).toFixed(),
        label: 'Distance (km)',
        unit: 'km',
      },
      elevation: {
        id: 'elevation',
        sortable: true,
        fun: (d: Activity) => d.total_elevation_gain,
        format: (v: number) =>
          v >= 10_000 ? (v / 1_000).toFixed() + 'k' : v.toFixed(),
        label: 'Elevation (m)',
        unit: 'm',
      },
      time: {
        id: 'time',
        sortable: true,
        fun: (d: Activity) => (d.elapsed_time ?? 0) / 3600,
        format: (v: number) => v.toFixed(0),
        label: 'Duration (h)',
        unit: 'h',
      },
    },
  },
  timePeriod: {
    type: 'categorical',
    label: 'Time Period',
    options: {
      year: {
        id: 'year',
        label: 'Year',
        tick: d3.utcYear,
        days: 365,
        tickFormat: '%Y',
        averagingDomain: [0, 0],
      },
      month: {
        id: 'month',
        label: 'Month',
        tick: d3.utcMonth,
        days: 30,
        tickFormat: '%b %Y',
        averagingDomain: [0, 3],
      },
      week: {
        id: 'week',
        label: 'Week',
        tick: d3.timeMonday,
        days: 7,
        tickFormat: '%Y-%m-%d',
        averagingDomain: [0, 12],
      },
      day: {
        id: 'day',
        label: 'Day',
        tick: d3.timeDay,
        days: 1,
        tickFormat: '%Y-%m-%d',
        averagingDomain: [0, 90],
      },
    },
  },
  group: {
    type: 'categorical',
    label: 'Group',
    options: {
      sport_group: {
        id: 'sport_group',
        label: 'Type',
        format: (id: keyof typeof categorySettings) =>
          categorySettings[id].name,
        fun: (d: Activity) => aliasMap[d.sport_type] ?? 'misc',
        icon: (id: keyof typeof categorySettings) => categorySettings[id].icon,
      },
      no_group: {
        id: 'no_group',
        label: 'All',
        format: () => 'All',
        fun: () => 'All',
        icon: () => 'child-reaching',
      },
    },
  },
  yScale: {
    type: 'categorical',
    label: 'Y Scale',
    options: {
      linear: {
        id: 'linear',
        label: 'Linear',
      },
      sqrt: {
        id: 'sqrt',
        label: 'Sqrt',
      },
      cbrt: {
        id: 'cbrt',
        label: 'Cbrt',
      },
    },
  },
} as const;

export const defaultSettings: TimelineSetting = {
  averaging: { value: 1, domain: [0, 3] },
  value: 'distance',
  timePeriod: 'month',
  group: 'sport_group',
  yScale: 'linear',
};

type TimelineSetting = {
  averaging: { value: number; domain: [number, number] };
  yScale: keyof typeof settings.yScale.options;
  value: keyof typeof settings.value.options;
  timePeriod: keyof typeof settings.timePeriod.options;
  group: keyof typeof settings.group.options;
};

type Spec = {
  averaging: number;
  yScale: (typeof settings.yScale.options)[keyof typeof settings.yScale.options];
  value: (typeof settings.value.options)[keyof typeof settings.value.options];
  timePeriod: (typeof settings.timePeriod.options)[keyof typeof settings.timePeriod.options];
  group: (typeof settings.group.options)[keyof typeof settings.group.options];
};

export const getter = (setting: TimelineSetting): Spec => ({
  averaging: setting.averaging.value,
  yScale: settings.yScale.options[setting.yScale],
  value: settings.value.options[setting.value],
  timePeriod: settings.timePeriod.options[setting.timePeriod],
  group: settings.group.options[setting.group],
});

export const setter =
  (timeline: TimelineSetting) =>
    <K extends keyof TimelineSetting>(name: K, value: TimelineSetting[K]) => {
      if (['value', 'group', 'yScale'].includes(name)) {
        const newTimeline = { ...timeline, [name]: value };
        return newTimeline;
      }
      if (name === 'averaging') {
        return {
          ...timeline,
          averaging: {
            value,
            domain: timeline.averaging.domain,
          },
        };
      }
      if (name === 'timePeriod') {
        {
          const oldDays = settings.timePeriod.options[timeline.timePeriod].days;
          const newDays =
            settings.timePeriod.options[
              value as keyof typeof settings.timePeriod.options
            ].days;
          const oldValue = timeline.averaging.value;
          const newValue = Math.round((oldValue * oldDays) / newDays);
          const newTimeline = {
            ...timeline,
            timePeriod: value,
            averaging: {
              value: newValue,
              domain: [
                0,
                settings.timePeriod.options[
                  value as keyof typeof settings.timePeriod.options
                ].averagingDomain[1],
              ],
            },
          };
          return newTimeline;
        }
      }
    };

type TimelineRow = {
  date: Date;
  value: number;
  type: string;
};

const groupColor = (group: keyof typeof categorySettings | 'All') =>
  group === 'All' ? '#000000' : resolveChartCategoryColors()[group];

const buildRows = (activities: Activity[], setting: TimelineSetting) => {
  const timeline = getter(setting);

  const extent = d3.extent(activities, (d) =>
    timeline.timePeriod.tick(new Date(d.start_date_local)),
  );
  if (extent[0] == undefined || extent[1] == undefined) return null;

  const groupExtent = Array.from(new Set(activities.map(timeline.group.fun)));

  const range: Date[] = timeline.timePeriod.tick.range(
    extent[0],
    timeline.timePeriod.tick.ceil(extent[1]),
  );

  const groups = d3.group(
    activities,
    (d) => timeline.timePeriod.tick(new Date(d.start_date_local)),
    timeline.group.fun,
  );

  const data: TimelineRow[] = range.flatMap((date) =>
    groupExtent.map((type) => ({
      date,
      type,
      value:
        groups.get(date)?.get(type) != undefined
          ? d3.sum(groups.get(date)!.get(type)!, timeline.value.fun)
          : 0,
    })),
  );

  return { timeline, groupExtent, range, data };
};

export const chart =
  (setting: TimelineSetting) =>
    ({
      activities,
      width,
    }: {
      activities: Activity[];
      width: number;
      height: number;
      theme: 'light' | 'dark';
    }) => {
      const built = buildRows(activities, setting);
      if (!built) return null;
      const { timeline, groupExtent } = built;
      const bigPlot = width > 500;

      const curve = d3Curve(d3.curveMonotoneX);
      const smoothed = rollingWindow(built.data, {
        by: 'type',
        size: timeline.averaging + 1,
        anchor: 'middle',
        orderBy: 'date',
        outputs: {
          smoothed: { value: 'value', reduce: 'mean' },
        },
      });

      const yScaleFactory =
        timeline.yScale.id === 'sqrt'
          ? () => d3.scaleSqrt()
          : timeline.yScale.id === 'cbrt'
            ? () => d3.scalePow().exponent(1 / 3)
            : () => d3.scaleLinear();

      const formatValueTick = bigPlot
        ? timeline.value.format
        : prepend(' ', timeline.value.format);

      return defineChart({
        marks: [
          ruleY([0]),
          areaY(built.data, {
            x: 'date',
            y1: 0,
            y2: 'value',
            color: 'type',
            fillOpacity: 0.1,
            curve: d3Curve(d3.curveStep),
          }),
          lineY(smoothed, {
            x: 'date',
            y: 'smoothed',
            z: 'type',
            color: 'type',
            curve,
            strokeWidth: 2,
          }),
          crosshair({ marker: true }),
        ],
        scales: {
          x: {
            scale: d3.scaleUtc().domain([built.range[0]!, built.range[built.range.length - 1]!]),
            axis: {
              ticks: { size: 12 },
              tickLabels: bigPlot ? undefined : { rotate: 0 },
            },
          },
          y: {
            scale: yScaleFactory,
            nice: true,
            axis: {
              ticks: { size: 12, format: formatValueTick },
              tickLabels: bigPlot ? undefined : { rotate: -90, anchor: 'start' },
            },
          },
        },
        color: {
          domain: groupExtent,
          range: groupExtent.map((g) => groupColor(g as keyof typeof categorySettings | 'All')),
        },
        tooltip: {
          use: tooltip,
          items: [
            // A `group` item both renders a formatted row and suppresses
            // the library's default tooltip title, which otherwise falls
            // back to the raw, unformatted group key (e.g. "bcXcSki").
            {
              channel: 'group',
              label: timeline.group.label,
              text: (point) => timeline.group.format(point.group as never),
            },
            {
              id: 'date',
              label: 'Date',
              text: (point) => d3.timeFormat(timeline.timePeriod.tickFormat)(point.datum.date),
            },
            {
              id: 'value',
              label: timeline.value.label,
              text: (point) => {
                const datum = point.datum as TimelineRow & { smoothed?: number };
                return timeline.value.format(datum.smoothed ?? datum.value);
              },
            },
          ],
        },
      });
    };

export const Legend = ({
  setting,
  activities,
}: {
  setting: TimelineSetting;
  activities: Activity[];
  theme: 'light' | 'dark';
}) => {
  const built = buildRows(activities, setting);
  if (!built) return null;
  const { timeline, groupExtent } = built;
  if (groupExtent.length <= 1) return null;

  return React.createElement(
    'div',
    { className: 'flex items-center space-x-2 text-xs' },
    groupExtent.map((group) =>
      React.createElement(
        'span',
        { key: group, className: 'flex items-center space-x-1' },
        React.createElement('span', {
          className: 'inline-block h-2 w-2 rounded-full',
          style: { backgroundColor: groupColor(group as keyof typeof categorySettings | 'All') },
        }),
        React.createElement('span', null, timeline.group.format(group as never)),
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
