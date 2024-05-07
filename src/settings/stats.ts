import {library} from "@fortawesome/fontawesome-svg-core";
import {fas} from "@fortawesome/free-solid-svg-icons";

library.add(fas);
import * as d3 from "d3";

import {type Activity} from "~/server/db/schema";
import {categorySettings, aliasMap} from "./category";

export const calendarSettings = {
  values: {
    distance: {
      id: "distance",
      fun: (d: Activity) => d.distance,
      format: (v: number) => (v / 1000).toFixed() + "km",
      label: "Distance",
      unit: "km",
      reducer: d3.sum,
      color: {scheme: "reds", type: "sqrt", ticks: 3},
    },
    elevation: {
      id: "elevation",
      fun: (d: Activity) => d.total_elevation_gain,
      format: (v: number) => (v / 1.0).toFixed() + "m",
      label: "Elevation",
      unit: "km",
      reducer: d3.sum,
      color: {scheme: "reds", type: "sqrt", ticks: 3},
    },
    time: {
      id: "time",
      fun: (d: Activity) => d.elapsed_time,
      format: (v: number) => (v / 3600).toFixed(1) + "h",
      label: "Duration",
      unit: "h",
      reducer: d3.sum,
      color: {scheme: "reds", type: "sqrt", ticks: 3},
    },
    type: {
      id: "type",
      fun: (d: Activity) => aliasMap[d.sport_type],
      format: (
        groupName:
          | keyof typeof categorySettings
          | "Multiple"
      ) => {
        if (groupName === "Multiple") {
          return "Multiple";
        }
        return categorySettings[groupName].name;
      },
      label: "Sport Type",
      unit: "",
      reducer: (
        v: Activity[],
        fun: (d: Activity) => keyof typeof categorySettings
      ): string => {
        const set = new Set(v.map(fun));
        return set.size > 1
          ? "Multiple"
          : (set.values().next().value as string);
      },
      color: {
        domain: [
          ...Object.keys(categorySettings),
          "Multiple",
        ],
        range: [
          ...Object.values(categorySettings).map(
            (x) => x.color
          ),
          "#aaa",
        ],
      },
    },
  },
};

export const scatterSettings = {
  values: {
    distance: {
      id: "distance",
      fun: (d: Activity) => d.distance! / 1000,
      format: (v: number) => v.toFixed() + "km",
      formatAxis: (v: number) => v.toFixed(),
      label: "Distance",
      unit: "km",
    },
    elevation: {
      id: "elevation",
      fun: (d: Activity) => d.total_elevation_gain,
      format: (v: number) => (v / 1.0).toFixed() + "m",
      formatAxis: (v: number) => (v / 1.0).toFixed(),
      label: "Elevation",
      unit: "km",
    },
    time: {
      id: "time",
      fun: (d: Activity) => d.elapsed_time! / 3600,
      format: (v: number) => v.toFixed(1) + "h",
      formatAxis: (v: number) => v.toFixed(1),
      label: "Duration",
      unit: "h",
    },
    date: {
      id: "date",
      fun: (d: Activity) => new Date(d.start_date_local!),
      formatAxis: (v: Date) => d3.timeFormat("%b %Y")(v),
      format: (v: Date) => d3.timeFormat("%Y-%m-%d")(v),
      label: "Date",
      unit: "",
    },
    average_speed: {
      id: "average_speed",
      fun: (d: Activity) => d.average_speed,
      format: (v: number) => (v * 3.6).toFixed(1) + "km/h",
      formatAxis: (v: number) => (v * 3.6).toFixed(1),
      label: "Avg Speed",
      unit: "km/h",
    },
  },
  groups: {
    sport_group: {
      id: "sport_group",
      fun: (d: Activity) => aliasMap[d.sport_type],
      color: (id: keyof typeof categorySettings) =>
        categorySettings[id].color,
      icon: (id: keyof typeof categorySettings) =>
        categorySettings[id].icon,
      label: "Group",
    },
  },
  color: (id: keyof typeof categorySettings) =>
    categorySettings[id].color,
};

export const timelineSettings = {
  values: {
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
      label: "Distance",
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
      label: "Elevation",
      unit: "m",
    },
    time: {
      id: "time",
      sortable: true,
      fun: (d: Activity) => d.elapsed_time,
      format: (v: number) => (v / 3600).toFixed(1),
      label: "Duration",
      unit: "h",
    },
  },
  timePeriods: {
    year: {
      id: "year",
      label: "Year",
      tick: d3.utcYear,
      days: 365,
      tickFormat: "%Y",
      averaging: {min: 0, max: 0},
    },
    month: {
      id: "month",
      label: "Month",
      tick: d3.utcMonth,
      days: 30,
      tickFormat: "%b %Y",
      averaging: {min: 0, max: 3},
    },
    week: {
      id: "week",
      label: "Week",
      tick: d3.timeMonday,
      days: 7,
      tickFormat: "%Y-%m-%d",
      averaging: {min: 0, max: 12},
    },
    day: {
      id: "day",
      label: "Day",
      tick: d3.timeDay,
      days: 1,
      tickFormat: "%Y-%m-%d",
      averaging: {min: 0, max: 90},
    },
  },
  groups: {
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
  yScales: {
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
};

export const progressSettings = {
  values: {
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
      label: "Distance",
      unit: "km",
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
      label: "Elevation",
      unit: "m",
    },
    time: {
      id: "time",
      sortable: true,
      fun: (d: Activity) =>
        Math.round(d.elapsed_time! / 360) / 10,
      format: (v: number) => v.toFixed(1),
      label: "Duration",
      unit: "h",
    },
  },
  by: {
    year: {
      id: "year",
      label: "Year",
      tick: d3.utcYear,
      legendFormat: "%Y",
      tickFormat: "%b",
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
      legendFormat: "%b %Y",
      tickFormat: "%d",
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
      tickFormat: "%a",
      nTicks: 7,
      legendFormat: "%Y-%m-%d",
      domain: [
        new Date("2024-01-01"),
        new Date("2024-01-07 23:59:59"),
      ],
    },
  },
};
