import {library} from "@fortawesome/fontawesome-svg-core";
import {fas} from "@fortawesome/free-solid-svg-icons";
import * as Plot from "@observablehq/plot";
import * as htl from "htl";
library.add(fas);
import * as d3 from "d3";

import {type Activity} from "~/server/db/schema";
import {
  categorySettings,
  aliasMap,
} from "~/settings/category";

export const settings = {
  value: {
    type: "categorical",
    label: "Value",
    options: {
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
          fun: (
            d: Activity
          ) => keyof typeof categorySettings
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
  },
};

type CalendarSetting = {
  value: keyof typeof settings.value.options;
};

export const defaultSettings: CalendarSetting = {
  value: "type",
};

type Spec = {
  value: (typeof settings.value.options)[keyof typeof settings.value.options];
};

const getter = (setting: CalendarSetting): Spec => ({
  value: settings.value.options[setting.value],
});

const setter =
  (calendar: CalendarSetting) =>
  <K extends keyof CalendarSetting>(
    name: K,
    value: CalendarSetting[K]
  ) => {
    return {...calendar, [name]: value};
  };

function makeCalendar({
  date = Plot.identity,
  inset = 1.5,
  ...options
} = {}) {
  let D;
  return {
    fy: {
      transform: (data) =>
        (D = Plot.valueof(data, date, Array)).map((d) =>
          d.getUTCFullYear()
        ),
    },
    x: {
      transform: () =>
        D.map((d) => d3.utcMonday.count(d3.utcYear(d), d)),
    },
    y: {
      transform: () =>
        D.map((d) => (d.getUTCDay() + 6) % 7),
    },
    inset,
    ...options,
  };
}

class MonthLine extends Plot.Mark {
  static defaults = {
    stroke: "black",
    strokeWidth: 1,
  };
  constructor(data, options = {}) {
    const {x, y} = options;
    super(
      data,
      {
        x: {value: x, scale: "x"},
        y: {value: y, scale: "y"},
      },
      options,
      MonthLine.defaults
    );
  }
  render(index, {x, y}, {x: X, y: Y}, dimensions) {
    const {marginTop, marginBottom, height} = dimensions;
    const dx = x.bandwidth(),
      dy = y.bandwidth();
    return htl.svg`<path opacity=${
      this.opacity
    } fill=none stroke=${
      this.stroke
    } stroke-width=1 d=${Array.from(
      index,
      (i) =>
        `${
          Y[i] > marginTop + dy * 1.5 // is the first day a Monday?
            ? `M${X[i] + dx},${marginTop}V${Y[i]}h${-dx}`
            : `M${X[i]},${marginTop}`
        }V${height - marginBottom}`
    ).join("")}>`;
  }
}

export const plot =
  (calendarSetting: CalendarSetting) =>
  ({
    activities,
    width,
    height,
  }: {
    activities: Activity[];
    width: number;
    height: number;
  }) => {
    const {value} = getter(calendarSetting);
    const activitiesByDate = d3.group(activities, (f) =>
      d3.utcDay(new Date(f.start_date_local))
    );

    const widthPlot = 1000;

    console.log(value);

    const dayTotals = d3.map(
      d3.rollup(
        activities,
        (v) => value.reducer(v, value.fun),
        (d) => d3.utcDay(new Date(d.start_date_local))
      ),
      ([key, value]) => ({date: key, value})
    );

    const start = d3.min(dayTotals, (d) => d.date);

    const end = d3.utcDay.offset(
      d3.max(dayTotals, (d) => d.date)
    );

    const heightPlot =
      start == undefined || end == undefined
        ? 800
        : ((end.getFullYear() - start.getFullYear() + 1) *
            widthPlot) /
          5.8;

    return Plot.plot({
      figure: true,
      style: {fontSize: "10pt"},
      marginRight: 0,
      marginLeft: 50,
      marginTop: 20,
      width: widthPlot,
      height: heightPlot,
      axis: null,
      padding: 0,
      x: {
        domain: d3.range(54),
      },
      y: {
        axis: "left",
        domain: [-1, 0, 1, 2, 3, 4, 5, 6],
        ticks: [0, 1, 2, 3, 4, 5, 6],
        tickSize: 0,
        tickFormat: (day) =>
          Plot.formatWeekday()((day + 1) % 7),
      },
      fy: {
        padding: 0.1,
        reverse: true,
      },
      color: value.color,
      marks: [
        Plot.text(
          d3.utcYears(d3.utcYear(start), end),
          makeCalendar({
            text: d3.utcFormat("%Y"),
            fontWeight: "bold",
            frameAnchor: "right",
            x: 0,
            y: -1,
            dx: -20,
          })
        ),

        Plot.text(
          d3
            .utcMonths(d3.utcMonth(start), end)
            .map(d3.utcMonday.ceil),
          makeCalendar({
            text: d3.utcFormat("%b"),
            frameAnchor: "left",
            y: -1,
            dx: -5,
          })
        ),
        new MonthLine(
          d3.utcMonths(d3.utcMonth(start), end),
          makeCalendar({opacity: 0.3, strokeWidth: 1})
        ),
        Plot.cell(
          dayTotals,
          makeCalendar({
            date: "date",
            fill: "value",
            channels: {
              title: (d) =>
                `${d.date.toDateString()}\n\n${
                  activitiesByDate
                    .get(d.date)
                    .map(
                      (a) =>
                        a.name +
                        (value.format == null
                          ? ""
                          : ": " +
                            value.format(value.fun(a)))
                    )
                    ?.join("\n") ?? ""
                }`,
            },
            opacity: 0.5,
            tip: {
              fontSize: 12,
            },
            rx: 2,
          })
        ),

        Plot.text(
          d3.utcDays(start, end),
          makeCalendar({
            text: d3.utcFormat("%-d"),
            fontSize: 10,
          })
        ),
      ],
    });
  };

export const legend =
  (calendarSetting: CalendarSetting) =>
  (plot: Plot.Plot) => {
    const {value} = getter(calendarSetting);
    return plot.legend("color", {
      ...value.color,
      tickFormat: value.format,
      label: value.label,
      width: 300,
      height: 40,
      marginLeft: 10,
      marginRight: 10,
      marginBottom: 20,
      marginTop: 15,
    });
  };

export default {
  settings,
  defaultSettings,
  plot,
  legend,
  getter,
  setter,
};
