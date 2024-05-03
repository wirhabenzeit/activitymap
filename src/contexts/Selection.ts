import {StateCreator} from "zustand";
import {TotalZustand} from "./Zustand";

export type SelectionZustand = {
  selected: number[];
  highlighted: number;
  setSelected: (selected: number[]) => void;
  setHighlighted: (highlighted: number) => void;
};

export const selectionSlice: StateCreator<
  TotalZustand,
  [["zustand/immer", never]],
  [],
  SelectionZustand
> = (set) => ({
  selected: [],
  highlighted: 0,
  setSelected: (selected) =>
    set((state) => {
      state.selected = selected;
    }),
  setHighlighted: (highlighted) =>
    set((state) => {
      state.highlighted = highlighted;
    }),
});
