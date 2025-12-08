import { type StateCreator } from 'zustand';
import { type SetStateAction } from 'react';
import { type RootState } from './index';
import { type Activity } from '~/server/db/schema';
import { defaultStatsSettings, type StatsSetting } from '~/components/stats';

export enum StatsPlots {
  calendar = '/stats/calendar',
  progress = '/stats/progress',
  timeline = '/stats/timeline',
  scatter = '/stats/scatter',
}

export type StatsTab = typeof StatsPlots[keyof typeof StatsPlots];

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
  color: string;
};

export type StatsCalendar = {
  value: Value;
};

export type StatsState = {
  activeTab: StatsTab;
  settingsOpen: boolean;
  settings: StatsSetting;
};

export type StatsActions = {
  setActiveTab: (update: SetStateAction<StatsTab>) => void;
  setSettingsOpen: (update: SetStateAction<boolean>) => void;
  setSettings: (update: SetStateAction<StatsSetting>) => void;
};

export type StatsSlice = StatsState & StatsActions;

export const createStatsSlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  StatsSlice
> = (set) => ({
  // Initial state
  activeTab: StatsPlots.scatter,
  settingsOpen: true,
  settings: defaultStatsSettings,

  // Actions
  setActiveTab: (update) =>
    set((state) => {
      state.activeTab =
        typeof update === 'function' ? update(state.activeTab) : update;
    }),

  setSettingsOpen: (update) =>
    set((state) => {
      state.settingsOpen =
        typeof update === 'function' ? update(state.settingsOpen) : update;
    }),

  setSettings: (update) =>
    set((state) => {
      state.settings =
        typeof update === 'function' ? update(state.settings) : update;
    }),
});
