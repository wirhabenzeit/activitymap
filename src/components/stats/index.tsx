import progress from "./progress";
import scatter from "./scatter";
import calendar from "./calendar";
import timeline from "./timeline";

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

export const commonSettings = {
  grid: true,
  style: {
    fontSize: "10pt",
  },
  figure: true,
  marginRight: 20,
  marginTop: 30,
  marginBottom: 20,
  marginLeft: 30,
};

type ArgType<T> = T extends (arg: infer U) => string
  ? U
  : never;

export const prepend = <
  T extends (...args: unknown[]) => string,
>(
  text: string,
  func: T
) =>
  func != undefined
    ? (arg: ArgType<T>) => text + func(arg)
    : undefined;

export default statsPlots;
