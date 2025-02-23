import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import { type Dispatch, type SetStateAction } from 'react';

export type SelectionState = {
  selected: number[];
  highlighted: number;
};

export type SelectionActions = {
  setSelected: Dispatch<SetStateAction<number[]>>;
  setHighlighted: (highlighted: number) => void;
};

export type SelectionSlice = SelectionState & SelectionActions;

export const createSelectionSlice: StateCreator<
  RootState,
  [['zustand/immer', never]],
  [],
  SelectionSlice
> = (set) => ({
  // Initial state
  selected: [],
  highlighted: 0,

  // Actions
  setSelected: (value) =>
    set((state) => {
      state.selected =
        typeof value === 'function' ? value(state.selected) : value;
      state.highlighted = 0;
    }),

  setHighlighted: (highlighted) =>
    set((state) => {
      state.highlighted = highlighted;
    }),
});
