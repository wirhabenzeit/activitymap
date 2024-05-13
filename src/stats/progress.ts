import type {Activity} from "~/server/db/schema";

import * as Plot from "@observablehq/plot";
import * as d3 from "d3";

import {commonSettings} from "~/stats";
import {X} from "@mui/icons-material";

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
        format: (v: number) => v,
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
        nTicks: 6,
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
        nTicks: 6,
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
        nTicks: 7,
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
    const showCrosshair = width > 500;

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
          new Date(entry.start_date_local).getTime() -
          by
            .tick(new Date(entry.start_date_local))
            .getTime()
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
      ...(showCrosshair
        ? {marginBottom: 40, marginLeft: 70}
        : {}),
      width,
      height,
      x: {
        tickFormat: by.tickFormat,
        axis: "top",
        domain: by.domain,
        label: null,
        ticks: by.nTicks,
      },
      y: {
        axis: "right",
        label: null,
        tickFormat: value.format,
        ticks: 6,
      },
      color: {
        //type: "categorical",
        scheme: "viridis",
        reverse: true,
        type: "ordinal",
        legend: false,
        tickFormat: by.legendFormat,
      },
      marks: [
        Plot.frame(),
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
              stroke: by.legendFormat,
              y: false,
              [value.label]: (x) => value.format(x),
            },
          })
        ),
        ...(showCrosshair
          ? [
              Plot.crosshair(data, {
                y: "cumsum",
                x: "virtualDate",
                color: by.label,
              }),
            ]
          : []),
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
