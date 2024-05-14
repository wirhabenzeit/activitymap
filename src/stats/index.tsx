import progress from "./progress";
import scatter from "./scatter";
import calendar from "./calendar";
import timeline from "./timeline";

const statsPlots = {
  progress,
  scatter,
  calendar,
  timeline,
} as const;

export type StatsSetting = {
  [K in keyof typeof statsPlots]: (typeof statsPlots)[K]["defaultSettings"];
};

export type StatsSettings = {
  [K in keyof typeof statsPlots]: (typeof statsPlots)[K]["settings"];
};

export const defaultStatsSettings: StatsSetting = {
  timeline: timeline.defaultSettings,
  progress: progress.defaultSettings,
  scatter: scatter.defaultSettings,
  calendar: calendar.defaultSettings,
};

export type StatsSetter = {
  progress: <K extends keyof StatsSetting["progress"]>(
    name: K,
    value: StatsSetting["progress"][K]
  ) => void;
  scatter: <K extends keyof StatsSetting["scatter"]>(
    name: K,
    value: StatsSetting["scatter"][K]
  ) => void;
  calendar: <K extends keyof StatsSetting["calendar"]>(
    name: K,
    value: StatsSetting["calendar"][K]
  ) => void;
  timeline: <K extends keyof StatsSetting["timeline"]>(
    name: K,
    value: StatsSetting["timeline"][K]
  ) => void;
};

export const commonSettings = {
  grid: true,
  style: {
    fontSize: "10pt",
  },
  figure: true,
  marginRight: 40,
  marginTop: 40,
  marginBottom: 20,
  marginLeft: 30,
};

export default statsPlots;
