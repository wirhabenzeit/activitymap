import { type Dispatch, type SetStateAction } from 'react';
import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import {
  type SortingState,
  type VisibilityState,
  type Updater,
  type ColumnPinningState,
} from '@tanstack/react-table';
import { type WritableDraft } from 'immer';

export type SummaryRowState = null | 'page' | 'all';
export type DensityState = 'sm' | 'md' | 'lg';

export type ListState = {
  sorting: SortingState;
  density: DensityState;
  summaryRow: SummaryRowState;
  columnVisibility: VisibilityState;
  columnPinning: ColumnPinningState;
};

export type ListActions = {
  setDensity: Dispatch<SetStateAction<DensityState>>;
  setSorting: Dispatch<SetStateAction<SortingState>>;
  setSummaryRow: Dispatch<SetStateAction<SummaryRowState>>;
  setColumnVisibility: Dispatch<Updater<VisibilityState>>;
  setColumnPinning: Dispatch<Updater<ColumnPinningState>>;
};

export type ListSlice = {
  compactList: ListState & ListActions;
  fullList: ListState & ListActions;
};

const createListActions = (
  set: (
    partial:
      | RootState
      | Partial<RootState>
      | ((state: WritableDraft<RootState>) => void),
    replace?: false,
  ) => void,
  listType: 'compactList' | 'fullList',
): ListActions => ({
  setDensity: (value) =>
    set((state) => {
      state[listType].density =
        typeof value === 'function' ? value(state[listType].density) : value;
    }),
  setSorting: (value) =>
    set((state) => {
      state[listType].sorting =
        typeof value === 'function' ? value(state[listType].sorting) : value;
    }),
  setSummaryRow: (value) =>
    set((state) => {
      state[listType].summaryRow =
        typeof value === 'function' ? value(state[listType].summaryRow) : value;
    }),
  setColumnVisibility: (value) =>
    set((state) => {
      state[listType].columnVisibility =
        typeof value === 'function'
          ? value(state[listType].columnVisibility)
          : value;
    }),
  setColumnPinning: (value) =>
    set((state) => {
      state[listType].columnPinning =
        typeof value === 'function'
          ? value(state[listType].columnPinning)
          : value;
    }),
});

export const createListSlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  ListSlice
> = (set) => ({
  compactList: {
    density: 'sm',
    columnPinning: {
      left: ['name'],
      right: ['edit'],
    },
    sorting: [{ id: 'id', desc: true }],
    columnVisibility: {
      select: false,
      id: false,
      time: false,
      sport_type: false,
      moving_time: false,
      average_speed: false,
      elev_high: false,
      elev_low: false,
      weighted_average_watts: false,
      average_watts: false,
      max_watts: false,
      max_heartrate: false,
      kudos_count: false,
      average_heartrate: false,
      edit: false,
      photos: false,
      is_complete: false,
    },
    summaryRow: null,
    ...createListActions(set, 'compactList'),
  },
  fullList: {
    density: 'sm',
    columnPinning: {
      left: ['name'],
      right: ['edit'],
    },
    sorting: [{ id: 'id', desc: true }],
    columnVisibility: {
      id: false,
      time: false,
      sport_type: false,
      moving_time: false,
      elev_high: false,
      elev_low: false,
      weighted_average_watts: false,
      max_watts: false,
      max_heartrate: false,
      kudos_count: false,
      average_heartrate: false,
      edit: false,
      photos: true,
      is_complete: false,
    },
    summaryRow: 'page',
    ...createListActions(set, 'fullList'),
  },
});
