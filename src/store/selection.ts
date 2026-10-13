import { type StateCreator } from 'zustand';
import { type RootState } from './index';
import {
  emptySelection,
  selectionTransition,
  selectionPickIDs,
  type ActivitySelection,
  type SelectionEvent,
} from '~/lib/activity-selection';
import { type Dispatch, type SetStateAction } from 'react';

export type SelectionState = {
  combineSelections: boolean;
  onlySelected: boolean;
  selected: number[];
  highlighted: number;
  /** Null until the first library snapshot is available. */
  knownSelectionIDs: number[] | null;
  visibleSelectionIDs: number[] | null;
};

export type SelectionActions = {
  setCombineSelections: (enabled: boolean) => void;
  setOnlySelected: (enabled: boolean) => void;
  pickActivities: (ids: number[]) => number[];
  toggleSelectedActivity: (id: number) => void;
  addSelectedActivities: (ids: number[]) => void;
  removeSelectedActivities: (ids: number[]) => void;
  clearSelection: () => void;
  resetSelectionScope: () => void;
  selectForMap: (id: number) => void;
  setSelected: Dispatch<SetStateAction<number[]>>;
  setHighlighted: (highlighted: number) => void;
  reconcileSelection: (knownIDs: number[] | null, visibleIDs: number[]) => void;
};
export type SelectionSlice = SelectionState & SelectionActions;

function model(state: SelectionState): ActivitySelection {
  return {
    ...emptySelection(),
    selectedIDs: state.selected,
    activeID: state.highlighted || null,
    knownIDs: state.knownSelectionIDs,
    eligibleIDs: state.visibleSelectionIDs,
    combine: state.combineSelections,
    onlySelected: state.onlySelected,
  };
}
function apply(state: SelectionState, event: SelectionEvent) {
  const next = selectionTransition(model(state), event);
  state.selected = next.selectedIDs;
  state.highlighted = next.activeID ?? 0;
  state.knownSelectionIDs = next.knownIDs;
  state.visibleSelectionIDs = next.eligibleIDs;
  state.combineSelections = next.combine;
  state.onlySelected = next.onlySelected;
}

export const createSelectionSlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  SelectionSlice
> = (set, get) => ({
  selected: [],
  highlighted: 0,
  knownSelectionIDs: null,
  visibleSelectionIDs: null,
  combineSelections: false,
  onlySelected: false,
  setCombineSelections: (enabled) =>
    set((state) => apply(state, { type: 'set_combine', enabled })),
  setOnlySelected: (enabled) =>
    set((state) => apply(state, { type: 'set_only_selected', enabled })),
  pickActivities: (ids) => {
    const hits = selectionPickIDs(model(get()), ids);
    set((state) => apply(state, { type: 'pick', ids: hits }));
    return hits;
  },
  toggleSelectedActivity: (id) =>
    set((state) => apply(state, { type: 'toggle', id })),
  addSelectedActivities: (ids) =>
    set((state) => apply(state, { type: 'add', ids })),
  removeSelectedActivities: (ids) =>
    set((state) => apply(state, { type: 'remove', ids })),
  clearSelection: () => set((state) => apply(state, { type: 'clear' })),
  resetSelectionScope: () =>
    set((state) => apply(state, { type: 'clear_scope' })),
  selectForMap: (id) =>
    set((state) =>
      apply(state, { type: 'show_on_map', id, hasGeometry: true }),
    ),
  // Compatibility for hydration, sharing and explicit bulk adapters. Input
  // handlers use the named commands above, never updater shape as intent.
  setSelected: (value) =>
    set((state) =>
      apply(state, {
        type: typeof value === 'function' ? 'update' : 'replace',
        ids: typeof value === 'function' ? value(state.selected) : value,
      }),
    ),
  setHighlighted: (id) =>
    set((state) => apply(state, { type: 'activate', id })),
  reconcileSelection: (knownIDs, eligibleIDs) =>
    set((state) => {
      const same = (a: number[] | null, b: number[] | null) =>
        a === b ||
        (a !== null &&
          b !== null &&
          a.length === b.length &&
          a.every((id, i) => id === b[i]));
      if (
        !same(state.knownSelectionIDs, knownIDs) ||
        !same(state.visibleSelectionIDs, eligibleIDs)
      )
        apply(state, { type: 'reconcile', knownIDs, eligibleIDs });
    }),
});
