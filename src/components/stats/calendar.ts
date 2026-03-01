import * as Plot from '@observablehq/plot';
import * as d3 from 'd3';

import { type Activity } from '~/server/db/schema';
import { categorySettings, aliasMap } from '~/settings/category';

type SportGroup = keyof typeof categorySettings;
type CalendarTypeValue = SportGroup | 'Multiple';

type NumericValueOption = {
  id: 'distance' | 'elevation' | 'time';
  fun: (d: Activity) => number;
  format: (v: number) => string;
  label: string;
  unit: string;
  reduce: (v: Activity[]) => number;
  color: { scheme: string; type: string; ticks: number };
};

type TypeValueOption = {
  id: 'type';
  fun: (d: Activity) => SportGroup;
  format: (groupName: CalendarTypeValue) => string;
  label: string;
  unit: '';
  reduce: (v: Activity[]) => CalendarTypeValue;
  color: { domain: CalendarTypeValue[]; range: string[] };
};

export const settings = {
  value: {
    type: 'categorical',
    label: 'Value',
    options: {
      distance: {
        id: 'distance',
        fun: (d: Activity) => d.distance ?? 0,
        format: (v: number) => (v / 1000).toFixed() + 'km',
        label: 'Distance',
        unit: 'km',
        reduce: (v: Activity[]): number => d3.sum(v, (d) => d.distance ?? 0),
        color: { scheme: 'reds', type: 'sqrt', ticks: 3 },
      },
      elevation: {
        id: 'elevation',
        fun: (d: Activity) => d.total_elevation_gain ?? 0,
        format: (v: number) => v.toFixed() + 'm',
        label: 'Elevation',
        unit: 'm',
        reduce: (v: Activity[]): number =>
          d3.sum(v, (d) => d.total_elevation_gain ?? 0),
        color: { scheme: 'reds', type: 'sqrt', ticks: 3 },
      },
      time: {
        id: 'time',
        fun: (d: Activity) => d.elapsed_time ?? 0,
        format: (v: number) => (v / 3600).toFixed(1) + 'h',
        label: 'Duration',
        unit: 'h',
        reduce: (v: Activity[]): number => d3.sum(v, (d) => d.elapsed_time ?? 0),
        color: { scheme: 'reds', type: 'sqrt', ticks: 3 },
      },
      type: {
        id: 'type',
        fun: (d: Activity) => aliasMap[d.sport_type] ?? 'misc',
        format: (groupName: CalendarTypeValue) => {
          if (groupName === 'Multiple') {
            return 'Multiple';
          }
          return categorySettings[groupName].name;
        },
        label: 'Sport Type',
        unit: '',
        reduce: (v: Activity[]): CalendarTypeValue => {
          const set = new Set(v.map((d) => aliasMap[d.sport_type] ?? 'misc'));
          if (set.size !== 1) {
            return 'Multiple';
          }
          return set.values().next().value!;
        },
        color: {
          domain: [...Object.keys(categorySettings), 'Multiple'] as CalendarTypeValue[],
          range: [...Object.values(categorySettings).map((x) => x.color), '#aaa'],
        },
      },
    },
  },
} as const satisfies {
  value: {
    type: 'categorical';
    label: string;
    options: {
      distance: NumericValueOption;
      elevation: NumericValueOption;
      time: NumericValueOption;
      type: TypeValueOption;
    };
  };
};

type CalendarSetting = {
  value: keyof typeof settings.value.options;
};

export const defaultSettings: CalendarSetting = {
  value: 'type',
};

type Spec = {
  value: (typeof settings.value.options)[keyof typeof settings.value.options];
};

type DayTotal = {
  date: Date;
  value: number | CalendarTypeValue;
  fy: number;
  x: number;
  y: number;
};

type MonthBoundary = {
  date: Date;
  fy: number;
  x: number;
  y: number;
};

type MonthLineOptions = Plot.MarkOptions & {
  x?: Plot.ChannelValue;
  y?: Plot.ChannelValue;
};

type BandScale = ((value: number) => number | undefined) & {
  bandwidth: () => number;
};

const getter = (setting: CalendarSetting): Spec => ({
  value: settings.value.options[setting.value],
});

const setter =
  (calendar: CalendarSetting) =>
  <K extends keyof CalendarSetting>(name: K, value: CalendarSetting[K]) => {
    return { ...calendar, [name]: value };
  };

const isBandScale = (scale: unknown): scale is BandScale => {
  return (
    typeof scale === 'function' &&
    typeof (scale as { bandwidth?: unknown }).bandwidth === 'function'
  );
};

const toNumericChannel = (channel: unknown): ArrayLike<number> | null => {
  if (
    typeof channel === 'object' &&
    channel !== null &&
    'length' in channel &&
    typeof channel.length === 'number'
  ) {
    return channel as ArrayLike<number>;
  }
  return null;
};

class MonthLine extends Plot.Mark {
  stroke: string;
  strokeWidth: number;

  static defaults = { stroke: 'currentColor', strokeWidth: 1 };

  constructor(data: Plot.Data, options: MonthLineOptions = {}) {
    const { x, y } = options;
    // @ts-expect-error Plot.Mark constructor signature is not exposed in the package typings.
    super(data, { x: { value: x, scale: 'x' }, y: { value: y, scale: 'y' } }, options, MonthLine.defaults);
    this.stroke =
      typeof options.stroke === 'string' ? options.stroke : MonthLine.defaults.stroke;
    this.strokeWidth =
      typeof options.strokeWidth === 'number'
        ? options.strokeWidth
        : MonthLine.defaults.strokeWidth;
  }

  render(
    index: number[],
    scales: Plot.ScaleFunctions,
    values: Plot.ChannelValues,
    dimensions: Plot.Dimensions,
  ): SVGElement | null {
    const xScale = scales.x;
    const yScale = scales.y;
    if (!isBandScale(xScale) || !isBandScale(yScale)) {
      return null;
    }

    const X = toNumericChannel(values.x);
    const Y = toNumericChannel(values.y);
    if (!X || !Y) {
      return null;
    }

    const { marginTop, marginBottom, height } = dimensions;
    const dx = xScale.bandwidth();
    const dy = yScale.bandwidth();
    const pathData = index
      .map((i) => {
        const x = X[i];
        const y = Y[i];
        if (x == null || y == null) {
          return '';
        }
        const start =
          y > marginTop + dy * 1.5
            ? `M${x + dx},${marginTop}V${y}h${-dx}`
            : `M${x},${marginTop}`;
        return `${start}V${height - marginBottom}`;
      })
      .join('');

    if (pathData.length === 0) {
      return null;
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', this.stroke);
    path.setAttribute('stroke-width', String(this.strokeWidth));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('d', pathData);
    return path;
  }
}

const isTypeValueOption = (
  value: Spec['value'],
): value is (typeof settings.value.options)['type'] => value.id === 'type';

const calendarCoordinates = (date: Date) => ({
  fy: date.getUTCFullYear(),
  x: d3.utcMonday.count(d3.utcYear(date), date),
  y: (date.getUTCDay() + 6) % 7,
});

const dayOfMonthLabel = d3.utcFormat('%-d');
const monthLabel = d3.utcFormat('%b');
const yearLabel = d3.utcFormat('%Y');

export const plot =
  (calendarSetting: CalendarSetting) =>
  ({
    activities,
    theme,
  }: {
    activities: Activity[];
    theme: 'light' | 'dark';
  }) => {
    const { value } = getter(calendarSetting);

    const activitiesByDate = d3.group(
      activities,
      (activity) => d3.utcDay(new Date(activity.start_date_local)),
    );

    const dayTotals: DayTotal[] = Array.from(
      d3.rollup(
        activities,
        (acts) => value.reduce(acts),
        (d) => d3.utcDay(new Date(d.start_date_local)),
      ),
      ([date, aggregated]) => ({
        date,
        value: aggregated,
        ...calendarCoordinates(date),
      }),
    );

    if (dayTotals.length === 0) return null;

    const start = d3.min(dayTotals, (d) => d.date);
    if (!start) return null;

    const maxDate = d3.max(dayTotals, (d) => d.date);
    if (!maxDate) return null;

    const end = d3.utcDay.offset(maxDate, 1);

    const widthPlot = 1000;
    const heightPlot =
      ((end.getFullYear() - start.getFullYear() + 1) * widthPlot) / 5.8;

    const yearData = d3.utcYears(d3.utcYear(start), end).map((date) => ({
      fy: date.getUTCFullYear(),
      label: yearLabel(date),
    }));

    const monthStartData = d3
      .utcMonths(d3.utcMonth(start), end)
      .map((date) => d3.utcMonday.ceil(date))
      .map((date) => ({
        ...calendarCoordinates(date),
        date,
        label: monthLabel(date),
      }));

    const monthBoundaryData: MonthBoundary[] = d3
      .utcMonths(d3.utcMonth(start), end)
      .map((date) => ({
        ...calendarCoordinates(date),
        date,
      }));

    const dayNumberData = d3.utcDays(start, end).map((date) => ({
      ...calendarCoordinates(date),
      date,
      label: dayOfMonthLabel(date),
    }));

    return Plot.plot({
      figure: true,
      style: { fontSize: '10pt' },
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
        axis: 'left',
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
        Plot.text(yearData, {
          fy: 'fy',
          text: 'label',
          x: 0,
          y: -1,
          dx: -20,
          textAnchor: 'end',
          fontWeight: 'bold',
        }),
        Plot.text(monthStartData, {
          fy: 'fy',
          x: 'x',
          y: -1,
          text: 'label',
          dx: -5,
          textAnchor: 'start',
        }),
        Plot.cell(dayTotals, {
          fy: 'fy',
          x: 'x',
          y: 'y',
          fill: 'value',
          opacity: 0.5,
          rx: 1,
          tip: true,
          channels: {
            title: (d: DayTotal) => {
              const dayActivities = activitiesByDate.get(d.date) ?? [];
              const details = dayActivities
                .map((activity) => {
                  if (isTypeValueOption(value)) {
                    return `${activity.name}: ${value.format(value.fun(activity))}`;
                  }
                  return `${activity.name}: ${value.format(value.fun(activity))}`;
                })
                .join('\n');
              return `${d.date.toDateString()}\n\n${details}`;
            },
          },
        }),
        Plot.text(dayNumberData, {
          fy: 'fy',
          x: 'x',
          y: 'y',
          text: 'label',
          fontSize: 11,
        }),
        new MonthLine(monthBoundaryData, {
          fy: 'fy',
          x: 'x',
          y: 'y',
          opacity: 1,
          strokeWidth: 4,
          stroke: theme === 'dark' ? 'black' : 'white',
        }),
      ],
    });
  };

export const legend =
  (calendarSetting: CalendarSetting) => (plot: Plot.Plot) => {
    const { value } = getter(calendarSetting);
    return plot.legend('color', {
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

const calendarPlot = {
  settings,
  defaultSettings,
  plot,
  legend,
  getter,
  setter,
};

export default calendarPlot;
