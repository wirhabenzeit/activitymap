import { type StateCreator } from 'zustand';
import { type Activity } from '~/server/db/schema';

import statsPlots, { defaultStatsSettings, type StatsSetting } from '~/stats';

export type Value = {
  id: string;
  fun: (act: Activity) => number;
  format: (value: number) => string;
  label: string;
  unit: string;
  reducer: (
    iterable: Activity[],
    accessor: (d: Activity) => number | string,
  ) => number | string;
  color: unknown;
};

export type StatsCalendar = {
  value: Value;
};

export type StatsZustand = {
  extent: (undefined | Date)[];
  statsSettings: StatsSetting;
  setStatsSettings: SetterFunctions;
};

type SetterFunctions = {
  [P in keyof typeof statsPlots]: <
    K extends keyof StatsSetting[P],
    S extends StatsSetting[P],
  >(
    name: K,
    value: S[K],
  ) => void;
};

export const statsSlice: StateCreator<
  StatsZustand,
  [['zustand/immer', never]],
  [],
  StatsZustand
> = (set, get) => {
  return {
    statsSettings: defaultStatsSettings,
    setStatsSettings: (
      Object.keys(statsPlots) as (keyof typeof statsPlots)[]
    ).reduce(
      (acc, plotName) => ({
        ...acc,
        [plotName]: <
          K extends keyof StatsSetting[typeof plotName],
          V extends StatsSetting[typeof plotName][K],
        >(
          name: K,
          value: V,
        ) =>
          set((state) => {
            if (!(plotName in state.statsSettings)) return;

            const setter = statsPlots[plotName].setter(
              get().statsSettings[plotName],
            );
            state.statsSettings[plotName] = setter(name, value);
          }),
      }),
      {} as SetterFunctions,
    ),
    extent: [undefined, undefined],
  };
};
