import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import { type Dispatch, type SetStateAction } from 'react';

export type SelectionState = {
  selected: number[];
  highlighted: number;
  /** Null until the first library snapshot is available. */
  knownSelectionIDs: number[] | null;
  visibleSelectionIDs: number[] | null;
};

export type SelectionActions = {
  setSelected: Dispatch<SetStateAction<number[]>>;
  setHighlighted: (highlighted: number) => void;
  reconcileSelection: (knownIDs: number[] | null, visibleIDs: number[]) => void;
};
export type SelectionSlice = SelectionState & SelectionActions;

/** Filter visibility changes clear focus but never activate another result. */
export const createSelectionSlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  SelectionSlice
> = (set) => ({
  selected: [],
  highlighted: 0,
  knownSelectionIDs: null,
  visibleSelectionIDs: null,

  setSelected: (value) =>
    set((state) => {
      const previous = state.selected;
      const requested = typeof value === 'function' ? value(previous) : value;
      const known = state.knownSelectionIDs && new Set(state.knownSelectionIDs);
      const next = [...new Set(requested)].filter(
        (id) => !known || known.has(id),
      );
      const removed = previous.some((id) => !next.includes(id));
      const added = next.some((id) => !previous.includes(id));
      // Functional updates describe add/remove/toggle. Plain arrays replace.
      if (typeof value === 'function' && !removed && !added) return;
      state.selected = next;
      const visible = next.filter(
        (id) =>
          !state.visibleSelectionIDs || state.visibleSelectionIDs.includes(id),
      );
      if ((typeof value !== 'function' || removed) && visible.length === 1)
        state.highlighted = visible[0]!;
      else if (!visible.includes(state.highlighted)) state.highlighted = 0;
    }),

  setHighlighted: (id) =>
    set((state) => {
      state.highlighted =
        id !== 0 &&
        state.selected.includes(id) &&
        (!state.visibleSelectionIDs || state.visibleSelectionIDs.includes(id))
          ? id
          : 0;
    }),

  reconcileSelection: (knownIDs, visibleIDs) =>
    set((state) => {
      const same = (a: number[] | null, b: number[] | null) =>
        a === b ||
        (a !== null &&
          b !== null &&
          a.length === b.length &&
          a.every((id, index) => id === b[index]));
      if (
        same(state.knownSelectionIDs, knownIDs) &&
        same(state.visibleSelectionIDs, visibleIDs)
      )
        return;
      const known = knownIDs && new Set(knownIDs);
      const visible = new Set(visibleIDs);
      const removed =
        known !== null && state.selected.some((id) => !known.has(id));
      state.knownSelectionIDs = knownIDs;
      state.visibleSelectionIDs = visibleIDs;
      if (known) state.selected = state.selected.filter((id) => known.has(id));
      const remaining = state.selected.filter((id) => visible.has(id));
      if (removed && remaining.length === 1) state.highlighted = remaining[0]!;
      else if (!remaining.includes(state.highlighted)) state.highlighted = 0;
    }),
});
