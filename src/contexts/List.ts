import { Dispatch, SetStateAction } from 'react';
import { StoreApi, type StateCreator } from 'zustand';
import { type TotalZustand } from './Zustand';
import {
  SortingState,
  VisibilityState,
  Updater,
  ColumnPinningState,
  ColumnFilter,
  ColumnFiltersState,
} from '@tanstack/react-table';
import { WritableDraft } from 'immer';

export type SummaryRowState = null | 'page' | 'all';
export type DensityState = 'sm' | 'md' | 'lg';

export type ListState = {
  sorting: SortingState;
  density: DensityState;
  summaryRow: SummaryRowState;
  columnVisibility: VisibilityState;
  columnPinning: ColumnPinningState;
};

export type ListZustand = {
  compactList: ListState & ListStateChangers;
  fullList: ListState & ListStateChangers;
};

export type ListStateChangers = {
  setDensity: Dispatch<SetStateAction<DensityState>>;
  setSorting: Dispatch<SetStateAction<SortingState>>;
  setSummaryRow: Dispatch<SetStateAction<SummaryRowState>>;
  setColumnVisibility: Dispatch<Updater<VisibilityState>>;
  setColumnPinning: Dispatch<Updater<ColumnPinningState>>;
};

const createListStateChangers = (
  set: (
    partial:
      | TotalZustand
      | Partial<TotalZustand>
      | ((state: WritableDraft<TotalZustand>) => void),
    replace?: false,
  ) => void,
  listType: 'compactList' | 'fullList',
): ListStateChangers => ({
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

export const listSlice: StateCreator<
  TotalZustand,
  [['zustand/immer', never]],
  [],
  ListZustand
> = (set, get) => ({
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
    },
    summaryRow: null,
    ...createListStateChangers(set, 'compactList'),
  },
  fullList: {
    density: 'md',
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
    },
    summaryRow: 'page',
    ...createListStateChangers(set, 'fullList'),
  },
});
