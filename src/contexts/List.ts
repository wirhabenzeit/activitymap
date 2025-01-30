import { type StateCreator } from 'zustand';
import { type TotalZustand } from './Zustand';
import { listSettings } from '~/settings/list';
import { SortingState, VisibilityState, Updater } from '@tanstack/react-table';

export type ListZustand = {
  compactList: {
    sorting: SortingState;
    setSorting: (updater: Updater<SortingState>) => void;
    summaryRow: boolean;
    setSummaryRow: (updater: Updater<boolean>) => void;
    columnVisibility: VisibilityState;
    setColumnVisibility: (update: Updater<VisibilityState>) => void;
  };
  fullList: {
    sorting: SortingState;
    setSorting: (updater: Updater<SortingState>) => void;
    summaryRow: boolean;
    setSummaryRow: (updater: Updater<boolean>) => void;
    columnVisibility: VisibilityState;
    setColumnVisibility: (update: Updater<VisibilityState>) => void;
  };
};

export const listSlice: StateCreator<
  TotalZustand,
  [['zustand/immer', never]],
  [],
  ListZustand
> = (set) => ({
  compactList: {
    ...listSettings.defaultState.compact,
    setSorting: (updater) =>
      set((state) => {
        state.compactList.sorting = updater(state.compactList.sorting);
      }),
    setSummaryRow: (updater) =>
      set((state) => {
        state.compactList.summaryRow = updater(state.compactList.summaryRow);
      }),
    setColumnVisibility: (updater) =>
      set((state) => {
        state.compactList.columnVisibility = updater(
          state.compactList.columnVisibility,
        );
      }),
  },
  fullList: {
    ...listSettings.defaultState.full,
    setSorting: (updater) =>
      set((state) => {
        state.fullList.sorting = updater(state.fullList.sorting);
      }),
    setSummaryRow: (updater) =>
      set((state) => {
        state.fullList.summaryRow = updater(state.fullList.summaryRow);
      }),
    setColumnVisibility: (updater) =>
      set((state) => {
        state.fullList.columnVisibility = updater(
          state.fullList.columnVisibility,
        );
      }),
  },
});
