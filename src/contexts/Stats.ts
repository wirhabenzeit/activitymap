import {type StateCreator} from "zustand";
import {
  type ValueColumn,
  type Activity,
} from "~/server/db/schema";

import {
  timelineSettings,
  scatterSettings,
  progressSettings,
  calendarSettings,
} from "~/settings/stats";

export type Value = {
  id: string;
  fun: (act: Activity) => number;
  format: (value: number) => string;
  label: string;
  unit: string;
  reducer: (
    iterable: Activity[],
    accessor: (d: Activity) => number | string
  ) => number | string;
  color: unknown;
};

export type StatsCalendar = {
  value: Value;
};

export type StatsZustand = {
  extent: (undefined | Date)[];
  timeline: StatsTimeline;
  calendar: StatsCalendar;
  scatter: StatsScatter;
  progress: StatsProgress;
  setCalendar: (cal: Value) => void;
};

export const statsSlice: StateCreator<
  StatsZustand,
  [["zustand/immer", never]],
  [],
  StatsZustand
> = (set) => ({
  extent: [undefined, undefined],
  timeline: {
    timePeriod: timelineSettings.timePeriods.month,
    value: timelineSettings.values.elevation,
    group: timelineSettings.groups.sport_group,
    averaging: 2,
    yScale: timelineSettings.yScales.linear,
  },
  calendar: {
    value: calendarSettings.values.type,
  },
  scatter: {
    xValue: scatterSettings.values.date,
    yValue: scatterSettings.values.elevation,
    size: scatterSettings.values.distance,
    group: scatterSettings.groups.sport_group,
    color: scatterSettings.color,
  },
  progress: {
    value: progressSettings.values.elevation,
    by: progressSettings.by.year,
  },
  setCalendar: (val) =>
    set((state) => {
      state.calendar.value = val;
    }),
  setProgress: (prog) =>
    set((state) => {
      state.progress = prog;
    }),
  setTimeline: ({
    value,
    timePeriod,
    group,
    yScale,
    averaging,
  }) =>
    set((state) => {
      if (value) state.timeline.value = value;
      if (group) state.timeline.group = group;
      if (yScale) state.timeline.yScale = yScale;
      if (averaging) state.timeline.averaging = averaging;
      if (timePeriod) {
        const oldDays = state.timeline.timePeriod.days;
        const newDays = timePeriod.days;
        state.timeline.timePeriod = timePeriod;
        state.timeline.averaging = Math.min(
          timePeriod.averaging.max,
          Math.round(
            (state.timeline.averaging * oldDays) / newDays
          )
        );
      }
    }),
  setScatter: ({xValue, yValue, size, group, color}) =>
    set((state) => {
      if (xValue) state.scatter.xValue = xValue;
      if (yValue) state.scatter.yValue = yValue;
      if (size) state.scatter.size = size;
      if (group) state.scatter.group = group;
      if (color) state.scatter.color = color;
    }),
});
