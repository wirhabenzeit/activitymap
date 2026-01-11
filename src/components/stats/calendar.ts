import * as Plot from "@observablehq/plot";
import * as htl from "htl";
import * as d3 from "d3";

import { type Activity } from "~/server/db/schema";
import { categorySettings, aliasMap } from "~/settings/category";

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
        reduce: (v: Activity[]): number => d3.sum(v, (d) => d.distance),
        color: { scheme: "reds", type: "sqrt", ticks: 3 },
      },
      elevation: {
        id: "elevation",
        fun: (d: Activity) => d.total_elevation_gain,
        format: (v: number) => (v / 1.0).toFixed() + "m",
        label: "Elevation",
        unit: "km",
        reduce: (v: Activity[]): number =>
          d3.sum(v, (d) => d.total_elevation_gain),
        color: { scheme: "reds", type: "sqrt", ticks: 3 },
      },
      time: {
        id: "time",
        fun: (d: Activity) => d.elapsed_time,
        format: (v: number) => (v / 3600).toFixed(1) + "h",
        label: "Duration",
        unit: "h",
        reduce: (v: Activity[]): number => d3.sum(v, (d) => d.elapsed_time),
        color: { scheme: "reds", type: "sqrt", ticks: 3 },
      },
      type: {
        id: "type",
        fun: (d: Activity) => aliasMap[d.sport_type],
        format: (groupName: keyof typeof categorySettings | "Multiple") => {
          if (groupName === "Multiple") {
            return "Multiple";
          }
          return categorySettings[groupName].name;
        },
        label: "Sport Type",
        unit: "",
        reduce: (v: Activity[]): string => {
          const set = new Set(v.map((d) => aliasMap[d.sport_type]));
          return set.size > 1
            ? "Multiple"
            : (set.values().next().value as string);
        },
        color: {
          domain: [...Object.keys(categorySettings), "Multiple"],
          range: [
            ...Object.values(categorySettings).map((x) => x.color),
            "#aaa",
          ],
        },
      },
    },
  },
} as const;

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
    <K extends keyof CalendarSetting>(name: K, value: CalendarSetting[K]) => {
      return { ...calendar, [name]: value };
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCalendar({ date = Plot.identity, inset = 0.5, ...options }: any = {}) {
  let D: Date[] | null;
  return {
    fy: {
      transform: (data: Plot.Data) =>
        (D = Plot.valueof(data, date, Array))?.map((d) => d.getUTCFullYear()),
    },
    x: {
      transform: () => D?.map((d) => d3.utcMonday.count(d3.utcYear(d), d)),
    },
    y: {
      transform: () => D?.map((d) => (d.getUTCDay() + 6) % 7),
    },
    inset,
    ...options,
  };
}

interface MonthLineOptions extends Plot.MarkOptions {
  x?: Plot.ChannelValue;
  y?: Plot.ChannelValue;
}

class MonthLine extends Plot.Mark {
  stroke: string;
  strokeWidth: number;

  static defaults = { stroke: "currentColor", strokeWidth: 1 };

  constructor(data: Plot.Data, options: MonthLineOptions = {}) {
    const { x, y } = options;
    // @ts-expect-error The type definition for Plot.Mark is missing the constructor signature
    super(data,
      { x: { value: x, scale: "x" }, y: { value: y, scale: "y" } },
      options,
      MonthLine.defaults
    );
    this.stroke = String(options.stroke ?? MonthLine.defaults.stroke);
    this.strokeWidth = Number(options.strokeWidth ?? MonthLine.defaults.strokeWidth);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(index: number[], { x, y }: any, { x: X, y: Y }: any, dimensions: any) {
    const { marginTop, marginBottom, height } = dimensions;
    const dx = x.bandwidth(),
      dy = y.bandwidth();
    return htl.svg`<path fill=none stroke=${this.stroke} stroke-width=${this.strokeWidth
      } d=${Array.from(
        index,
        (i) =>
          `${Y[i] > marginTop + dy * 1.5 // is the first day a Monday?
            ? `M${X[i] + dx},${marginTop}V${Y[i]}h${-dx}`
            : `M${X[i]},${marginTop}`
          }V${height - marginBottom}`,
      ).join("")}>`;
  }
}

export const plot =
  (calendarSetting: CalendarSetting) =>
    ({
      activities,
      theme,
    }: {
      activities: Activity[];
      theme: "light" | "dark";
    }) => {
      const { value } = getter(calendarSetting);
      const activitiesByDate = d3.group(activities, (f) =>
        d3.utcDay(new Date(f.start_date_local)),
      );

      const widthPlot = 1000;

      const dayTotals = d3.map(
        d3.rollup(
          activities,
          value.reduce as (acts: Activity[]) => number | string,
          (d) => d3.utcDay(new Date(d.start_date_local)),
        ),
        ([key, value]) => ({ date: key, value }),
      );

      if (dayTotals.length == 0) return null;

      const start = d3.min(dayTotals, (d) => d.date);

      const end = d3.utcDay.offset(d3.max(dayTotals, (d) => d.date)!);

      const heightPlot =
        start == undefined || end == undefined
          ? 800
          : ((end.getFullYear() - start.getFullYear() + 1) * widthPlot) / 5.8;

      return Plot.plot({
        figure: true,
        style: { fontSize: "10pt" },
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
          tickFormat: (day) => Plot.formatWeekday()((day + 1) % 7),
        },
        fy: {
          padding: 0.1,
          reverse: true,
        },
        color: value.color,
        marks: [
          Plot.text(
            d3.utcYears(d3.utcYear(start), end),
            (makeCalendar as any)({
              text: d3.utcFormat("%Y"),
              fontWeight: "bold",
              frameAnchor: "right",
              x: 0,
              y: -1,
              dx: -20,
            }),
          ),
          Plot.text(
            d3.utcMonths(d3.utcMonth(start), end).map(d3.utcMonday.ceil),
            (makeCalendar as any)({
              text: d3.utcFormat("%b"),
              frameAnchor: "left",
              y: -1,
              dx: -5,
            }),
          ),
          Plot.cell(
            dayTotals,
            (makeCalendar as any)({
              date: "date",
              fill: "value",
              opacity: 0.5,
              rx: 1,
              tip: true,
              channels: {
                title: (d: any) =>
                  `${d.date.toDateString()}\n\n${activitiesByDate
                    .get(d.date)!
                    .map(
                      (a) =>
                        a.name +
                        (value.format == null
                          ? ""
                          : ": " + (value.format as any)((value.fun as any)(a))),
                    )
                    ?.join("\n") ?? ""
                  }`,
              },
            }),
          ),
          //on(
          Plot.text(
            d3.utcDays(start!, end),
            (makeCalendar as any)({
              text: d3.utcFormat("%-d"),
              fontSize: 11,
            }),
          ),
          new MonthLine(
            d3.utcMonths(d3.utcMonth(start), end),
            (makeCalendar as any)({
              opacity: 1,
              strokeWidth: 4,
              stroke: theme == "dark" ? "black" : "white",
            }),
          ) as any,
        ],
      });
    };

export const legend =
  (calendarSetting: CalendarSetting) => (plot: Plot.Plot) => {
    const { value } = getter(calendarSetting);
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
