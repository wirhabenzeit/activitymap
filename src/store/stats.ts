import { type StateCreator } from 'zustand';
import { type Dispatch, type SetStateAction } from 'react';
import { type RootState } from './index';
import { type Activity } from '~/server/db/schema';
import { defaultStatsSettings, type StatsSetting } from '~/components/stats';

export type StatsTab =
  | '/stats/scatter'
  | '/stats/calendar'
  | '/stats/progress'
  | '/stats/timeline';

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
  [['zustand/immer', never]],
  [],
  StatsSlice
> = (set) => ({
  // Initial state
  activeTab: '/stats/scatter',
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
