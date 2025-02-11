import type { Activity } from '~/server/db/schema';

import * as Plot from '@observablehq/plot';
import * as d3 from 'd3';

import { commonSettings, prepend } from './index';

type ProgressSetting = {
  value: keyof typeof settings.value.options;
  by: keyof typeof settings.by.options;
};

type Spec = {
  by: (typeof settings.by.options)[keyof typeof settings.by.options];
  value: (typeof settings.value.options)[keyof typeof settings.value.options];
};

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

export const plot =
  (setting: ProgressSetting) =>
  ({
    activities,
    width,
    height,
  }: {
    activities: Activity[];
    width: number;
    height: number;
  }) => {
    const { by, value } = getter(setting);
    const bigPlot = width > 500;

    const cumulative = d3
      .groups(activities, (x) => by.tick(new Date(x.start_date_local)))
      .flatMap(([dateKey, acts]) => {
        acts = acts.sort(
          (a, b) => a.start_date_local_timestamp - b.start_date_local_timestamp,
        );
        if (acts.length == 0) return [];
        const cumsum = d3.cumsum(acts, value.fun);
        return [
          {
            start_date_local: by.tick(acts[0]!.start_date_local),
            by: dateKey,
            cumsum: 0,
          },
          ...acts.map((act, i) => ({
            ...act,
            by: dateKey,
            cumsum: cumsum[i],
          })),
        ];
      });

    let data = cumulative.map((entry) => ({
      ...entry,
      virtualDate: new Date(
        new Date('2024-01-01').getTime() +
          entry.start_date_local.getTime() -
          by.tick(entry.start_date_local).getTime(),
      ),
    }));

    const keys = Array.from(
      new d3.InternSet(data.map((x) => by.tick(x.by))),
    ).sort((a, b) => a.getTime() - b.getTime());

    if (keys.length == 0) return Plot.plot({});

    data = data
      .filter((x) =>
        keys
          .slice(-5)
          .map((y) => y.getTime())
          .includes(x.by.getTime()),
      )
      .map((x) => ({
        ...x,
        currentPeriod: x.by.getTime() == keys[keys.length - 1]!.getTime(),
      }));

    return Plot.plot({
      ...commonSettings,
      ...(bigPlot
        ? {
            //marginBottom: 40,
            marginLeft: 70,
            marginTop: 40,
          }
        : {}),
      width,
      height,
      color: {
        //type: "categorical",
        scheme: 'viridis',
        reverse: true,
        type: 'ordinal',
        legend: false,
        tickFormat: by.legendFormat,
      },
      x: { domain: by.domain },
      marks: [
        //Plot.frame(),
        Plot.axisX({
          anchor: 'top',
          label: null,
          ticks: by.ticks,
          tickSize: 12,
          ...(!bigPlot
            ? {
                tickFormat: prepend(' ', by.tickFormat),
                textAnchor: 'start',
                tickPadding: -10,
              }
            : { tickFormat: by.tickFormat }),
        }),
        Plot.axisY({
          label: null,
          tickFormat: value.tickFormat,
          tickSize: 12,
          tickSpacing: 120,
          //anchor: "right",
          ...(bigPlot
            ? {}
            : {
                tickRotate: -90,
                tickFormat: prepend(' ', value.tickFormat),
                textAnchor: 'start',
                tickSize: 14,
                tickPadding: -10,
              }),
          //tickSpacing: 60,
        }),
        //Plot.ruleY([0]),
        //Plot.ruleX([by.domain[0]]),
        Plot.ruleY(
          data,
          Plot.pointer({
            px: 'virtualDate',
            y: 'cumsum',
            stroke: 'by',
          }),
        ),
        Plot.ruleX(
          data,
          Plot.pointer({
            x: 'virtualDate',
            py: 'cumsum',
            stroke: 'by',
          }),
        ),
        Plot.gridX({
          ticks: by.gridTicks,
        }),
        Plot.line(data, {
          y: 'cumsum',
          x: 'virtualDate',
          stroke: 'by',
          curve: by.curve,
          opacity: 0.3,
          strokeWidth: (X: { currentPeriod: number }) =>
            X.currentPeriod ? 4 : 2,
        }),
        ...(by.dots
          ? [
              Plot.dot(data, {
                y: 'cumsum',
                x: 'virtualDate',
                stroke: 'by',
                opacity: (x: { currentPeriod: number }) =>
                  x.currentPeriod ? 1 : 0.5,
              }),
            ]
          : []),
        Plot.dot(
          data,
          Plot.pointer({
            y: 'cumsum',
            x: 'virtualDate',
            fill: 'by',
          }),
        ),
        Plot.tip(
          data,
          Plot.pointer({
            y: 'cumsum',
            x: 'virtualDate',
            stroke: 'by',
            channels: {
              Date: 'start_date_local',
              Name: 'name',
              [value.label]: value.fun,
            },
            format: {
              x: false,
              stroke: false,
              y: false,
              [value.label]: value.format,
              Date: (x: Date) => d3.timeFormat('%Y-%m-%d')(x),
            },
          }),
        ),
      ],
    });
  };

export const legend = () => (plot: Plot.Plot) => plot.legend('color');

const config = {
  settings,
  defaultSettings,
  plot,
  legend,
  getter,
  setter,
};

export default config;
