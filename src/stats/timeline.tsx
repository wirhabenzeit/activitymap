import {library} from "@fortawesome/fontawesome-svg-core";
import {fas} from "@fortawesome/free-solid-svg-icons";
import * as Plot from "@observablehq/plot";
import {BarChart, ShowChart} from "@mui/icons-material";

library.add(fas);
import * as d3 from "d3";

import {type Activity} from "~/server/db/schema";
import {
  categorySettings,
  aliasMap,
} from "~/settings/category";

import {commonSettings} from "~/stats";

export const settings = {
  averaging: {
    type: "number",
    label: "Averaging",
    minIcon: <BarChart />,
    maxIcon: <ShowChart />,
  },
  value: {
    type: "categorical",
    label: "Value",
    options: {
      count: {
        id: "count",
        fun: () => 1,
        sortable: false,
        format: (v: number) => v,
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
            : v < 10_000
            ? (v / 1000).toFixed(1)
            : (v / 1000).toFixed(),
        label: "Distance (km)",
        unit: "km",
      },
      elevation: {
        id: "elevation",
        sortable: true,
        fun: (d: Activity) => d.total_elevation_gain,
        format: (v: number) =>
          v >= 10_000
            ? (v / 1_000).toFixed() + "k"
            : v.toFixed(),
        label: "Elevation (m)",
        unit: "m",
      },
      time: {
        id: "time",
        sortable: true,
        fun: (d: Activity) => d.elapsed_time,
        format: (v: number) => (v / 3600).toFixed(1),
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
        fun: (d: Activity) => aliasMap[d.sport_type],
        color: (id: keyof typeof categorySettings) =>
          categorySettings[id].color,
        icon: (id: keyof typeof categorySettings) =>
          categorySettings[id].icon,
      },
      /*sport_type: {
      id: "sport_type",
      label: "Type",
      fun: (d: Activity) => d.sport_type,
      color: (id) => categorySettings[aliasMap[id]].color,
      icon: (id) => categorySettings[aliasMap[id]].icon,
    },*/
      no_group: {
        id: "no_group",
        label: "All",
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
};

export const defaultSettings: TimelineSetting = {
  averaging: {value: 1, domain: [0, 3]},
  value: "distance",
  timePeriod: "month",
  group: "sport_group",
  yScale: "linear",
};

type TimelineSetting = {
  averaging: {value: number; domain: [number, number]};
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
  timePeriod:
    settings.timePeriod.options[setting.timePeriod],
  group: settings.group.options[setting.group],
});

export const setter =
  (timeline: TimelineSetting) =>
  <K extends keyof TimelineSetting>(
    name: K,
    value: TimelineSetting[K]
  ) => {
    if (["value", "group", "yScale"].includes(name)) {
      const newTimeline = {...timeline, [name]: value};
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
        const oldDays =
          settings.timePeriod.options[timeline.timePeriod]
            .days;
        const newDays =
          settings.timePeriod.options[
            value as keyof typeof settings.timePeriod.options
          ].days;
        const oldValue = timeline.averaging.value;
        const newValue = Math.round(
          (oldValue * oldDays) / newDays
        );
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
      timeline.timePeriod.tick(new Date(d.start_date_local))
    );

    const groupExtent = Array.from(
      new Set(activities.map(timeline.group.fun))
    );

    const range = timeline.timePeriod.tick.range(
      extent[0],
      timeline.timePeriod.tick.ceil(extent[1])
    );

    const groups = d3.group(
      activities,
      (d) =>
        timeline.timePeriod.tick(
          new Date(d.start_date_local)
        ),
      timeline.group.fun
    );

    const timeMap = d3.map(range, (date) => {
      return groupExtent.map((type) => ({
        date,
        type,
        value:
          groups.get(date)?.get(type) != undefined
            ? d3.sum(
                groups.get(date)?.get(type),
                timeline.value.fun
              )
            : 0,
      }));
    });

    const data = timeMap
      .flat()
      .sort(
        (a, b) =>
          a.start_date_local_timestamp -
          b.start_date_local_timestamp
      );

    const map = new d3.InternMap(
      timeMap.map((arr) => [
        arr[0].date,
        new d3.InternMap(
          arr.map(({value, type}) => [type, value])
        ),
      ])
    );

    const showCrosshair = width > 500;

    return Plot.plot({
      ...commonSettings,
      ...(showCrosshair
        ? {marginBottom: 40, marginLeft: 70}
        : {}),
      y: {
        tickFormat: timeline.value.format,
        ticks: 6,
        ...timeline.yScale.prop,
        label: "",
        axis: "right",
      },
      x: {axis: "top"},
      height: Math.max(height, 100),
      width: Math.max(width, 100),
      marks: [
        Plot.frame(),
        Plot.ruleY([0]),
        ...[
          groupExtent.flatMap((type) => [
            ...(showCrosshair
              ? [
                  Plot.text(
                    range,
                    Plot.pointerX({
                      textAnchor: "end",
                      px: (d) => d,
                      y: (d) => map.get(d).get(type),
                      dx: -15,
                      frameAnchor: "left",
                      text: (d) =>
                        timeline.value.format(
                          map.get(d)?.get(type)
                        ),
                      fill: timeline.group.color(type),
                      fontSize: 12,
                    })
                  ),
                ]
              : []),
            Plot.dot(
              range,
              Plot.pointer({
                x: (d) => d,
                y: (d) => map.get(d)?.get(type),
                opacity: 0.5,
                fill: timeline.group.color(type),
              })
            ),
          ]),
        ],
        Plot.ruleX(range, Plot.pointerX({})),
        Plot.text(
          range,
          Plot.pointerX({
            text: (d) =>
              d3.timeFormat(timeline.timePeriod.tickFormat)(
                d
              ),
            x: (d) => d,
            frameAnchor: "bottom",
            dy: 20,
          })
        ),
        Plot.lineY(
          data,
          Plot.windowY({
            x: "date",
            y: "value",
            k: timeline.averaging + 1,
            curve: "monotone-x",
            reduce: "mean",
            stroke: (x) => timeline.group.color(x.type),
            channels: {
              Date: (d) =>
                `${d3.timeFormat(
                  timeline.timePeriod.tickFormat
                )(d.date)} ± ${timeline.averaging} ${
                  timeline.timePeriod.id
                }s`,
            },
            tip: {
              channels: {
                Date: "date",
                Type: "type",
                [timeline.value.label]: "value",
              },
              format: {
                y: false,
                x: false,
                stroke: false,
                z: false,
                Type: (x) => categorySettings[x].name,
                [timeline.value.label]: (x) =>
                  `${timeline.value.format(x)}${
                    timeline.value.unit
                  }`,
              },
            },
          })
        ),
        Plot.areaY(data, {
          x: "date",
          y2: "value",
          y1: 0,
          fill: (x) => timeline.group.color(x.type),
          opacity: 0.1,
          curve: "step",
        }),
      ],
    });
  };

export const legend = () => (plot: Plot.Plot) => null;

export default {
  plot,
  settings,
  defaultSettings,
  legend,
  getter,
  setter,
};
