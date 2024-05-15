import {library} from "@fortawesome/fontawesome-svg-core";
import {fas} from "@fortawesome/free-solid-svg-icons";

library.add(fas);
import * as d3 from "d3";

import * as Plot from "@observablehq/plot";

import {type Activity} from "~/server/db/schema";
import {
  categorySettings,
  aliasMap,
} from "~/settings/category";

import {commonSettings} from "~/stats";
import {act} from "react";

const valueOptions = {
  distance: {
    id: "distance",
    fun: (d: Activity) => d.distance! / 1000,
    format: (v: number) => v.toFixed() + "km",
    formatAxis: (v: number) => v.toFixed(),
    label: "Distance (km)",
    unit: "km",
  },
  elevation: {
    id: "elevation",
    fun: (d: Activity) => d.total_elevation_gain,
    format: (v: number) => (v / 1.0).toFixed() + "m",
    formatAxis: (v: number) => (v / 1.0).toFixed(),
    label: "Elevation (m)",
    unit: "m",
  },
  duration: {
    id: "duration",
    fun: (d: Activity) => d.elapsed_time! / 3600,
    format: (v: number) => v.toFixed(1) + "h",
    formatAxis: (v: number) => v.toFixed(0),
    label: "Duration (h)",
    unit: "h",
  },
  date: {
    id: "date",
    fun: (d: Activity) => d.start_date_local,
    formatAxis: (v: Date) => d3.timeFormat("%Y")(v),
    format: (v: Date) => d3.timeFormat("%Y-%m-%d")(v),
    label: "Date",
    unit: "",
  },
  average_speed: {
    id: "average_speed",
    fun: (d: Activity) => (d.average_speed || 0) * 3.6,
    format: (v: number) => v.toFixed(1) + "km/h",
    formatAxis: (v: number) => v.toFixed(1),
    label: "Avg Speed (km/h)",
    unit: "km/h",
  },
} as const;

export const settings = {
  xValue: {
    type: "categorical",
    label: "X",
    options: valueOptions,
  },
  yValue: {
    type: "categorical",
    label: "Y",
    options: valueOptions,
  },
  rValue: {
    type: "categorical",
    label: "R",
    options: valueOptions,
  },
  group: {
    type: "categorical",
    label: "Group",
    options: {
      sport_group: {
        id: "sport_group",
        fun: (d: Activity) =>
          aliasMap[
            d.sport_type
          ] as keyof typeof categorySettings,
        color: (id: keyof typeof categorySettings) =>
          categorySettings[id].color,
        icon: (id: keyof typeof categorySettings) =>
          categorySettings[id].icon,
        label: "Group",
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
  xValue: "date",
  yValue: "elevation",
  rValue: "duration",
  group: "sport_group",
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
  <K extends keyof ScatterSetting>(
    name: K,
    value: ScatterSetting[K]
  ) => {
    return {...scatter, [name]: value};
  };

export const plot =
  (setting: ScatterSetting) =>
  ({
    activities,
    width,
    height,
  }: {
    activities: Activity[];
    width: number;
    height: number;
  }) => {
    const bigPlot = width > 500;
    const {xValue, yValue, rValue, group} = getter(setting);
    return Plot.plot({
      ...commonSettings,
      ...(bigPlot
        ? {
            marginLeft: 70,
            marginTop: 40,
          }
        : {}),
      height: height,
      width: width,
      r: {
        range: [0, 10],
        domain: d3.extent(activities, (act: Activity) =>
          rValue.fun(act)
        ),
      },
      marks: [
        Plot.axisY({
          tickFormat: yValue.formatAxis,
          ticks: 6,
          label: null,
          anchor: "left",
          tickSize: 12,
          ...(bigPlot
            ? {}
            : {
                tickRotate: -90,
                tickFormat: (x) =>
                  ` ${yValue.formatAxis(x)}`,
                textAnchor: "start",
                tickSize: 14,
                tickPadding: -10,
              }),
        }),
        Plot.axisX({
          anchor: "top",
          label: null,
          tickSize: 12,
          ...(!bigPlot
            ? {
                tickFormat: (x) =>
                  ` ${xValue.formatAxis(x)}`,
                textAnchor: "start",
                tickPadding: -10,
              }
            : {tickFormat: xValue.formatAxis}),
        }),
        Plot.dot(activities, {
          x: xValue.fun,
          y: yValue.fun,
          r: rValue.fun,
          stroke: (d) => group.color(group.fun(d)),
          opacity: 0.7,
          channels: {
            Activity: (d) => d.name,
            [rValue.label]: rValue.fun,
            [xValue.label]: xValue.fun,
            [yValue.label]: yValue.fun,
          },
          tip: {
            format: {
              x: false,
              y: false,
              r: false,
              stroke: false,
              Activity: (x) => x,
              [rValue.label]: rValue.format,
              [xValue.label]: xValue.format,
              [yValue.label]: yValue.format,
            },
          },
        }),
        Plot.ruleY(
          activities,
          Plot.pointer({
            px: xValue.fun,
            y: yValue.fun,
            stroke: (d) => group.color(group.fun(d)),
          })
        ),
        Plot.ruleX(
          activities,
          Plot.pointer({
            x: xValue.fun,
            py: yValue.fun,
            stroke: (d) => group.color(group.fun(d)),
          })
        ),
        /*Plot.crosshair(activities, {
          x: xValue.fun,
          y: yValue.fun,
          color: (d) => group.color(group.fun(d)),
        }),*/
      ],
    });
  };

export const legend =
  (setting: ScatterSetting) => (plot: Plot.Plot) => {
    const {rValue} = getter(setting);
    const scale = plot.scale("r");
    if (
      !scale ||
      !scale.domain ||
      !scale.range ||
      !Array.isArray(scale.range) ||
      scale.range.length < 2
    )
      return null;
    const ticks = 4;
    const tickFormat = rValue.format;
    const label = rValue.label;
    const strokeWidth = 0.5;
    const strokeDasharray = "5,4";
    const lineHeight = 8;
    const gap = 20;
    const r0 = scale.range[1];

    let s;
    if (
      scale.type === "pow" &&
      scale.exponent !== undefined
    ) {
      s = d3
        .scalePow(scale.domain, scale.range)
        .exponent(scale.exponent);
    } else s = d3.scaleLinear(scale.domain, scale.range);

    const shiftY = label ? 10 : 0;

    let h = Infinity;
    const values = s
      .ticks(ticks)
      .reverse()
      .filter(
        (t) => h - s(t) > lineHeight / 2 && (h = s(t))
      );

    return Plot.plot({
      x: {type: "identity", axis: null},
      r: {type: "identity"},
      y: {type: "identity", axis: null},
      caption: "",
      marks: [
        Plot.link(values, {
          x1: r0 + 2,
          y1: (d) => 8 + 2 * r0 - 2 * s(d) + shiftY,
          x2: 2 * r0 + 2 + gap,
          y2: (d) => 8 + 2 * r0 - 2 * s(d) + shiftY,
          strokeWidth: strokeWidth / 2,
          strokeDasharray,
        }),
        Plot.dot(values, {
          r: s,
          x: r0 + 2,
          y: (d) => 8 + 2 * r0 - s(d) + shiftY,
          strokeWidth,
        }),
        Plot.text(values, {
          x: 2 * r0 + 2 + gap,
          y: (d) => 8 + 2 * r0 - 2 * s(d) + shiftY,
          textAnchor: "start",
          dx: 4,
          text: tickFormat,
        }),
        Plot.text(label ? [label] : [], {
          x: 0,
          y: 6,
          textAnchor: "start",
          fontWeight: "bold",
        }),
      ],
      width: 100,
      height: 40,
    });
  };

export default {
  plot,
  settings,
  defaultSettings,
  legend,
  getter,
  setter,
};
