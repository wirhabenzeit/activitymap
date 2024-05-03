import {type StateCreator} from "zustand";
import {type TotalZustand} from "./Zustand";

export type UIZustand = {
  drawerOpen: boolean;
  activeStatsTab:
    | "/stats/scatter"
    | "/stats/calendar"
    | "/stats/progress"
    | "/stats/timeline";
  statsSettingsOpen: boolean;
  userSettingsOpen: boolean;
  toggleDrawer: () => void;
  toggleUserSettings: () => void;
  setActiveStatsTab: (
    tab:
      | "/stats/scatter"
      | "/stats/calendar"
      | "/stats/progress"
      | "/stats/timeline"
  ) => void;
  toggleStatsSettings: () => void;
};

export const uiSlice: StateCreator<
  TotalZustand,
  [["zustand/immer", never]],
  [],
  UIZustand
> = (set) => ({
  drawerOpen: false,
  activeStatsTab: "/stats/calendar",
  statsSettingsOpen: true,
  userSettingsOpen: false,
  toggleUserSettings: () =>
    set((state) => {
      state.userSettingsOpen = !state.userSettingsOpen;
    }),
  toggleDrawer: () =>
    set((state) => {
      state.drawerOpen = !state.drawerOpen;
    }),
  setActiveStatsTab: (tab) =>
    set((state) => {
      state.activeStatsTab = tab;
    }),
  toggleStatsSettings: () =>
    set((state) => {
      state.statsSettingsOpen = !state.statsSettingsOpen;
    }),
});
