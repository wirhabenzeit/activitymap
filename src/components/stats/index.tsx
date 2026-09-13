import progress from "./progress";
import scatter from "./scatter";
import calendar from "./calendar-settings";
import timeline from "./timeline";

// The three charts rendered through the generic TanStack Charts host (plot.tsx).
export const chartPlots = {
  timeline,
  progress,
  scatter,
} as const;

export type ChartPlotName = keyof typeof chartPlots;

// All four stats tabs, including the standalone calendar-heatmap component,
// which only shares its settings/store shape with the generic host.
const statsPlots = {
  calendar,
  timeline,
  progress,
  scatter,
} as const;

export type StatsSetting = {
  [K in keyof typeof statsPlots]: (typeof statsPlots)[K]["defaultSettings"];
};

export type StatsSettings = {
  [K in keyof typeof statsPlots]: (typeof statsPlots)[K]["settings"];
};

export const defaultStatsSettings: StatsSetting = {
  calendar: calendar.defaultSettings,
  timeline: timeline.defaultSettings,
  progress: progress.defaultSettings,
  scatter: scatter.defaultSettings,
};

export type StatsSetter = {
  calendar: <K extends keyof StatsSetting["calendar"]>(
    name: K,
    value: StatsSetting["calendar"][K]
  ) => void;
  timeline: <K extends keyof StatsSetting["timeline"]>(
    name: K,
    value: StatsSetting["timeline"][K]
  ) => void;
  progress: <K extends keyof StatsSetting["progress"]>(
    name: K,
    value: StatsSetting["progress"][K]
  ) => void;
  scatter: <K extends keyof StatsSetting["scatter"]>(
    name: K,
    value: StatsSetting["scatter"][K]
  ) => void;
};

export const prepend = <T,>(text: string, func: (arg: T) => string) => {
  return (arg: T) => text + func(arg);
};

export default statsPlots;
