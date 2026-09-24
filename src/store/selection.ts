import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import { type Dispatch, type SetStateAction } from 'react';

export type SelectionState = {
  selected: number[];
  nearby: number[];
  highlighted: number;
};

export type SelectionActions = {
  setSelected: Dispatch<SetStateAction<number[]>>;
  setNearby: (nearby: number[]) => void;
  setHighlighted: (highlighted: number) => void;
};

export type SelectionSlice = SelectionState & SelectionActions;

export const createSelectionSlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  SelectionSlice
> = (set) => ({
  // Initial state
  selected: [],
  nearby: [],
  highlighted: 0,

  // Actions
  setSelected: (value) =>
    set((state) => {
      state.selected =
        typeof value === 'function' ? value(state.selected) : value;
      if (
        state.highlighted !== 0 &&
        !state.selected.includes(state.highlighted) &&
        !state.nearby.includes(state.highlighted)
      ) {
        state.highlighted = 0;
      }
    }),

  setNearby: (nearby) =>
    set((state) => {
      state.nearby = nearby;
      if (nearby.length === 1) {
        state.highlighted = nearby[0]!;
      } else if (nearby.length > 1 || !state.selected.includes(state.highlighted)) {
        state.highlighted = 0;
      }
    }),

  setHighlighted: (highlighted) =>
    set((state) => {
      state.highlighted = highlighted;
    }),
});
