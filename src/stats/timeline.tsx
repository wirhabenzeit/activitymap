import * as Plot from "@observablehq/plot";

import { ChartLine, ChartColumn } from "lucide-react";
import * as d3 from "d3";

import { type Activity } from "~/server/db/schema";
import { categorySettings, aliasMap } from "~/settings/category";

import { commonSettings, prepend } from "~/stats";

export const settings = {
  averaging: {
    type: "number",
    label: "Averaging",
    minIcon: <ChartColumn />,
    maxIcon: <ChartLine />,
  },
  value: {
    type: "categorical",
    label: "Value",
    options: {
      count: {
        id: "count",
        fun: () => 1,
        sortable: false,
        format: (v: number) => v.toFixed(0),
        label: "Count",
        unit: "",
      },
      distance: {
        id: "distance",
        fun: (d: Activity) => d.distance,
        sortable: true,
        format: (v: number) =>
          v >= 10_000_000
            ? (v / 1_000_000).toFixed() + "k"
            : (v / 1000).toFixed(),
        label: "Distance (km)",
        unit: "km",
      },
      elevation: {
        id: "elevation",
        sortable: true,
        fun: (d: Activity) => d.total_elevation_gain,
        format: (v: number) =>
          v >= 10_000 ? (v / 1_000).toFixed() + "k" : v.toFixed(),
        label: "Elevation (m)",
        unit: "m",
      },
      time: {
        id: "time",
        sortable: true,
        fun: (d: Activity) => (d.elapsed_time ?? 0) / 3600,
        format: (v: number) => v.toFixed(0),
        label: "Duration (h)",
        unit: "h",
      },
    },
  },
  timePeriod: {
    type: "categorical",
    label: "Time Period",
    options: {
      year: {
        id: "year",
        label: "Year",
        tick: d3.utcYear,
        days: 365,
        tickFormat: "%Y",
        averagingDomain: [0, 0],
      },
      month: {
        id: "month",
        label: "Month",
        tick: d3.utcMonth,
        days: 30,
        tickFormat: "%b %Y",
        averagingDomain: [0, 3],
      },
      week: {
        id: "week",
        label: "Week",
        tick: d3.timeMonday,
        days: 7,
        tickFormat: "%Y-%m-%d",
        averagingDomain: [0, 12],
      },
      day: {
        id: "day",
        label: "Day",
        tick: d3.timeDay,
        days: 1,
        tickFormat: "%Y-%m-%d",
        averagingDomain: [0, 90],
      },
    },
  },
  group: {
    type: "categorical",
    label: "Group",
    options: {
      sport_group: {
        id: "sport_group",
        label: "Type",
        format: (id: keyof typeof categorySettings) =>
          categorySettings[id].name,
        fun: (d: Activity) => aliasMap[d.sport_type],
        color: (id: keyof typeof categorySettings) =>
          categorySettings[id].color,
        icon: (id: keyof typeof categorySettings) => categorySettings[id].icon,
      },
      no_group: {
        id: "no_group",
        label: "All",
        format: () => "All",
        fun: () => "All",
        color: () => "#000000",
        icon: () => "child-reaching",
      },
    },
  },
  yScale: {
    type: "categorical",
    label: "Y Scale",
    options: {
      linear: {
        id: "linear",
        label: "Linear",
        prop: {
          type: "linear",
        },
      },
      sqrt: {
        id: "sqrt",
        label: "Sqrt",
        prop: {
          type: "sqrt",
        },
      },
      cbrt: {
        id: "cbrt",
        label: "Cbrt",
        prop: {
          type: "pow",
          exponent: 1 / 3,
        },
      },
    },
  },
} as const;

export const defaultSettings: TimelineSetting = {
  averaging: { value: 1, domain: [0, 3] },
  value: "distance",
  timePeriod: "month",
  group: "sport_group",
  yScale: "linear",
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
    if (["value", "group", "yScale"].includes(name)) {
      const newTimeline = { ...timeline, [name]: value };
      return newTimeline;
    }
    if (name === "averaging") {
      return {
        ...timeline,
        averaging: {
          value,
          domain: timeline.averaging.domain,
        },
      };
    }
    if (name === "timePeriod") {
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

export const plot =
  (setting: TimelineSetting) =>
  ({
    activities,
    width,
    height,
  }: {
    activities: Activity[];
    width: number;
    height: number;
  }) => {
    const timeline = getter(setting);

    const extent = d3.extent(activities, (d) =>
      timeline.timePeriod.tick(new Date(d.start_date_local)),
    );

    if (extent[0] == undefined || extent[1] == undefined) return null;

    const groupExtent = Array.from(
      new Set(
        activities.map(timeline.group.fun) as Array<
          keyof typeof categorySettings
        >,
      ),
    );

    const range = timeline.timePeriod.tick.range(
      extent[0],
      timeline.timePeriod.tick.ceil(extent[1]),
    );

    const groups = d3.group(
      activities,
      (d) => timeline.timePeriod.tick(new Date(d.start_date_local)),
      timeline.group.fun,
    );

    const timeMap = d3.map(range, (date) => {
      return groupExtent.map((type) => ({
        date,
        type,
        value:
          groups.get(date)?.get(type) != undefined
            ? d3.sum(groups.get(date)!.get(type)!, timeline.value.fun)
            : 0,
      }));
    });

    interface Data {
      date: Date;
      value: number;
      type: keyof typeof categorySettings;
    }

    const data: Data[] = timeMap
      .flat()
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((d) => ({
        ...d,
        [timeline.value.label]: d.value,
      }));

    const map = new d3.InternMap(
      timeMap.map((arr) => {
        return [
          arr[0]!.date,
          new d3.InternMap(arr.map(({ value, type }) => [type, value])),
        ];
      }),
    );

    const bigPlot = width > 500;

    return Plot.plot({
      ...commonSettings,
      ...(bigPlot
        ? {
            marginLeft: 70,
            marginTop: 50,
            marginRight: 60,
          }
        : {}),
      height: Math.max(height, 100),
      width: Math.max(width, 100),
      y: { ...timeline.yScale.prop },
      marks: [
        Plot.ruleY([0]),
        Plot.axisY({
          tickFormat: timeline.value.format,
          ticks: 6,
          ...timeline.yScale.prop,
          label: null,
          anchor: "left",
          tickSize: 12,
          ...(bigPlot
            ? {}
            : {
                tickRotate: -90,
                tickFormat: prepend(" ", timeline.value.format),
                textAnchor: "start",
                tickSize: 14,
                tickPadding: -10,
              }),
        }),
        Plot.gridX({
          ticks: "year",
        }),
        Plot.axisX({
          anchor: "top",
          label: null,
          tickSize: 12,
          ...(!bigPlot
            ? {
                textAnchor: "start",
                tickPadding: -10,
                tickFormat: d3.timeFormat(" '%y"),
              }
            : {}),
        }),
        ...[
          groupExtent.flatMap((type) => [
            ...(bigPlot
              ? [
                  Plot.text(
                    range,
                    Plot.pointerX({
                      textAnchor: "start",
                      px: (d: Date) => d,
                      y: (d: Date) => map.get(d)!.get(type),
                      dx: 8,
                      frameAnchor: "right",
                      text: (d: Date) =>
                        timeline.value.format(map.get(d)!.get(type)!),
                      fill: timeline.group.color(type),
                      fontSize: 12,
                    }),
                  ),
                ]
              : []),
            Plot.dot(
              range,
              Plot.pointerX({
                x: (d: Date) => d,
                y: (d: Date) => map.get(d)?.get(type),
                //opacity: 1,
                fill: timeline.group.color(type),
              }),
            ),
          ]),
        ],
        Plot.ruleX(range, Plot.pointerX({})),
        Plot.lineY(
          data,
          Plot.windowY({
            x: "date",
            y: timeline.value.label,
            k: timeline.averaging + 1,
            curve: "monotone-x",
            reduce: "mean",
            stroke: (x: Data) => timeline.group.color(x.type),
            channels: {
              Date: (d: Data) =>
                `${d3.timeFormat(timeline.timePeriod.tickFormat)(
                  d.date,
                )} ± ${timeline.averaging} ${timeline.timePeriod.id}s`,
            },
            tip: {
              channels: {
                Date: "date",
                Type: "type",
              },
              format: {
                y: timeline.value.format,
                Type: timeline.group.format,
                x: false,
                stroke: false,
                z: false,
              },
            },
          }),
        ),
        Plot.areaY(data, {
          x: "date",
          y2: "value",
          y1: 0,
          fill: (x: Data) => timeline.group.color(x.type),
          opacity: 0.1,
          curve: "step",
        }),
      ],
    });
  };

export const legend = () => () => null;

const config = {
  plot,
  settings,
  defaultSettings,
  legend,
  getter,
  setter,
};

export default config;
