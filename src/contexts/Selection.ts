import { type StateCreator } from 'zustand';
import { type TotalZustand } from './Zustand';
import { Dispatch, SetStateAction } from 'react';

export type SelectionZustand = {
  selected: number[];
  highlighted: number;
  setSelected: Dispatch<SetStateAction<number[]>>; //(selected: number[]) => void;
  setHighlighted: (highlighted: number) => void;
};

export const selectionSlice: StateCreator<
  TotalZustand,
  [['zustand/immer', never]],
  [],
  SelectionZustand
> = (set) => ({
  selected: [],
  highlighted: 0,
  setSelected: (value) =>
    set((state) => {
      state.selected =
        typeof value === 'function' ? value(state.selected) : value;
      state.highlighted = 0;
    }),
  // setSelected: (selected) =>
  //   set((state) => {
  //     state.selected = selected;
  //     state.highlighted = 0;
  //   }),
  setHighlighted: (highlighted) =>
    set((state) => {
      state.highlighted = highlighted;
    }),
});
