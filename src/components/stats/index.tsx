import progress from './progress';
import calendar from './calendar-settings';
import timeline from './timeline';

// The two charts rendered through the generic TanStack Charts host (plot.tsx).
export const chartPlots = {
  timeline,
  progress,
} as const;

export type ChartPlotName = keyof typeof chartPlots;

// The three legacy stats tabs, including the standalone calendar-heatmap component,
// which only shares its settings/store shape with the generic host.
const statsPlots = {
  calendar,
  timeline,
  progress,
} as const;

export type StatsSetting = {
  [K in keyof typeof statsPlots]: (typeof statsPlots)[K]['defaultSettings'];
};

export type StatsSettings = {
  [K in keyof typeof statsPlots]: (typeof statsPlots)[K]['settings'];
};

export const defaultStatsSettings: StatsSetting = {
  calendar: calendar.defaultSettings,
  timeline: timeline.defaultSettings,
  progress: progress.defaultSettings,
};

export type StatsSetter = {
  calendar: <K extends keyof StatsSetting['calendar']>(
    name: K,
    value: StatsSetting['calendar'][K],
  ) => void;
  timeline: <K extends keyof StatsSetting['timeline']>(
    name: K,
    value: StatsSetting['timeline'][K],
  ) => void;
  progress: <K extends keyof StatsSetting['progress']>(
    name: K,
    value: StatsSetting['progress'][K],
  ) => void;
};

export const prepend = <T,>(text: string, func: (arg: T) => string) => {
  return (arg: T) => text + func(arg);
};

export default statsPlots;
