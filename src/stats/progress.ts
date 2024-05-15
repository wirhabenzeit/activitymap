import type {Activity} from "~/server/db/schema";

import * as Plot from "@observablehq/plot";
import * as d3 from "d3";

import {commonSettings} from "~/stats";

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
    type: "categorical",
    label: "Value",
    options: {
      count: {
        id: "count",
        fun: () => 1,
        format: (v: number) => `${v}`,
        label: "Count",
        unit: "",
      },
      distance: {
        id: "distance",
        fun: (d: Activity) =>
          Math.round(d.distance! / 100) / 10,
        format: (v: number) =>
          v >= 10_000
            ? (v / 1_000).toFixed() + "k"
            : v < 10
            ? v.toFixed(1)
            : v.toFixed(),
        label: "Distance (km)",
      },
      elevation: {
        id: "elevation",
        sortable: true,
        fun: (d: Activity) =>
          Math.round(d.total_elevation_gain!),
        format: (v: number) =>
          v >= 10_000
            ? (v / 1_000).toFixed() + "k"
            : v.toFixed(),
        label: "Elevation (m)",
      },
      time: {
        id: "time",
        sortable: true,
        fun: (d: Activity) =>
          Math.round(d.elapsed_time! / 360) / 10,
        format: (v: number) => v.toFixed(0),
        label: "Duration (h)",
      },
    },
  },
  by: {
    type: "categorical",
    label: "By",
    options: {
      year: {
        id: "year",
        label: "Year",
        tick: d3.utcYear,
        legendFormat: d3.timeFormat("%Y"),
        tickFormat: d3.timeFormat("%b"),
        curve: "step-after",
        dots: false,
        ticks: "month",
        gridTicks: "month",
        domain: [
          new Date("2024-01-01"),
          new Date("2024-12-31 23:59:59"),
        ],
      },
      month: {
        id: "month",
        label: "Month",
        tick: d3.utcMonth,
        legendFormat: d3.timeFormat("%b %Y"),
        tickFormat: d3.timeFormat("%d"),
        curve: "basis",
        dots: true,
        gridTicks: "day",
        ticks: "week",
        domain: [
          new Date("2024-01-01"),
          new Date("2024-01-31 23:59:59"),
        ],
      },
      week: {
        id: "week",
        label: "Week",
        tick: d3.timeMonday,
        tickFormat: d3.timeFormat("%a"),
        curve: "basis",
        dots: true.valueOf,
        ticks: "day",
        gridTicks: "day",
        legendFormat: d3.timeFormat("%Y-%m-%d"),
        domain: [
          new Date("2024-01-01"),
          new Date("2024-01-07 23:59:59"),
        ],
      },
    },
  },
} as const;

export const defaultSettings: ProgressSetting = {
  by: "month",
  value: "elevation",
};

const getter = (setting: ProgressSetting): Spec => ({
  by: settings.by.options[setting.by],
  value: settings.value.options[setting.value],
});

const setter =
  (progress: ProgressSetting) =>
  <K extends keyof ProgressSetting>(
    name: K,
    value: ProgressSetting[K]
  ) => {
    return {...progress, [name]: value};
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
    const {by, value} = getter(setting);
    const bigPlot = width > 500;

    const cumulative = d3
      .groups(activities, (x) =>
        by.tick(new Date(x.start_date_local))
      )
      .flatMap(([dateKey, acts]) => {
        acts = acts.sort(
          (a, b) =>
            a.start_date_local_timestamp -
            b.start_date_local_timestamp
        );
        const cumsum = d3.cumsum(acts, value.fun);
        return [
          {
            start_date_local: by.tick(
              acts[0].start_date_local
            ),
            [by.label]: dateKey,
            cumsum: 0,
          },
          ...d3.zip(acts, cumsum).map(([act, sum]) => ({
            ...act,
            [by.label]: dateKey,
            cumsum: sum,
          })),
        ];
      });

    let data = cumulative.map((entry) => ({
      ...entry,
      virtualDate: new Date(
        new Date("2024-01-01").getTime() +
          entry.start_date_local!.getTime() -
          by.tick(entry.start_date_local).getTime()
      ),
    }));

    const keys = Array.from(
      new d3.InternSet(
        data.map((x) => by.tick(x[by.label]))
      )
    ).sort((a, b) => a - b);

    data = data
      .filter((x) =>
        keys
          .slice(-5)
          .map((y) => y.getTime())
          .includes(x[by.label].getTime())
      )
      .map((x) => ({
        ...x,
        currentPeriod:
          x[by.label].getTime() ==
          keys[keys.length - 1].getTime(),
      }));

    return Plot.plot({
      ...commonSettings,
      ...(bigPlot
        ? {
            marginBottom: 40,
            marginLeft: 70,
            marginTop: 40,
          }
        : {}),
      width,
      height,
      color: {
        //type: "categorical",
        scheme: "viridis",
        reverse: true,
        type: "ordinal",
        legend: false,
        tickFormat: by.legendFormat,
      },
      x: {domain: by.domain},
      marks: [
        //Plot.frame(),
        Plot.axisX({
          anchor: "top",
          label: null,
          ticks: by.ticks,
          tickSize: 12,
          ...(!bigPlot
            ? {
                tickFormat: (x) => ` ${by.tickFormat(x)}`,
                textAnchor: "start",
                tickPadding: -10,
              }
            : {tickFormat: by.tickFormat}),
        }),
        Plot.axisY({
          label: null,
          tickFormat: value.format,
          tickSize: 12,
          tickSpacing: 120,
          //anchor: "right",
          ...(bigPlot
            ? {}
            : {
                tickRotate: -90,
                tickFormat: (x) => ` ${value.format(x)}`,
                textAnchor: "start",
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
            px: "virtualDate",
            y: "cumsum",
            stroke: by.label,
          })
        ),
        Plot.ruleX(
          data,
          Plot.pointer({
            x: "virtualDate",
            py: "cumsum",
            stroke: by.label,
          })
        ),
        Plot.gridX({
          ticks: by.gridTicks,
        }),
        Plot.line(data, {
          y: "cumsum",
          x: "virtualDate",
          stroke: by.label,
          curve: by.curve,
          opacity: 0.3,
          strokeWidth: (X) => (X.currentPeriod ? 4 : 2),
        }),
        ...(by.dots
          ? [
              Plot.dot(data, {
                y: "cumsum",
                x: "virtualDate",
                stroke: by.label,
                opacity: (x) => (x.currentPeriod ? 1 : 0.5),
              }),
            ]
          : []),
        Plot.dot(
          data,
          Plot.pointer({
            y: "cumsum",
            x: "virtualDate",
            fill: by.label,
          })
        ),
        Plot.tip(
          data,
          Plot.pointer({
            y: "cumsum",
            x: "virtualDate",
            stroke: by.label,
            channels: {
              Date: "start_date_local",
              Name: "name",
              [value.label]: value.fun,
            },
            format: {
              x: false,
              stroke: false,
              y: false,
              [value.label]: value.format,
              Date: (x) => d3.timeFormat("%Y-%m-%d")(x),
            },
          })
        ),
        /*...(bigPlot
          ? [
              Plot.crosshair(data, {
                y: "cumsum",
                x: "virtualDate",
                color: by.label,
              }),
            ]
          : []),*/
      ],
    });
  };

export const legend = () => (plot: Plot.Plot) =>
  plot.legend("color");

export default {
  settings,
  defaultSettings,
  plot,
  legend,
  getter,
  setter,
};
