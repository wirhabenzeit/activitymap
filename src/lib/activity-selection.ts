/** Local browsing state; eligibility is always the ordinary filter scope. */
export interface ActivitySelection {
  selectedIDs: number[];
  activeID: number | null;
  inspectedID: number | null;
  eligibleIDs: number[] | null;
  knownIDs: number[] | null;
  combine: boolean;
  onlySelected: boolean;
}
export type SelectionEvent =
  | { type: 'replace' | 'add' | 'remove' | 'pick' | 'update'; ids: number[] }
  | { type: 'toggle' | 'activate' | 'inspect'; id: number }
  | { type: 'show_on_map'; id: number; hasGeometry: boolean }
  | { type: 'set_combine' | 'set_only_selected'; enabled: boolean }
  | { type: 'reconcile'; knownIDs: number[] | null; eligibleIDs: number[] }
  | { type: 'clear' | 'dismiss_inspection' | 'reset_scope' | 'clear_scope' };

export const emptySelection = (): ActivitySelection => ({
  selectedIDs: [],
  activeID: null,
  inspectedID: null,
  knownIDs: null,
  eligibleIDs: null,
  combine: false,
  onlySelected: false,
});
export function browsingIDs(
  state: Pick<ActivitySelection, 'selectedIDs' | 'onlySelected'>,
  eligible: number[],
) {
  if (!state.onlySelected) return eligible;
  const selected = new Set(state.selectedIDs);
  return eligible.filter((id) => selected.has(id));
}
const eligible = (state: ActivitySelection, id: number) =>
  state.eligibleIDs === null || state.eligibleIDs.includes(id);
const known = (state: ActivitySelection, id: number) =>
  state.knownIDs === null || state.knownIDs.includes(id);
const canonical = (state: ActivitySelection, ids: number[]) => {
  const knownIDs = state.knownIDs === null ? null : new Set(state.knownIDs);
  return [...new Set(ids)].filter(
    (id) =>
      Number.isSafeInteger(id) && id > 0 && (!knownIDs || knownIDs.has(id)),
  );
};

/** Validate the actual hit set, including frames rendered before filters update. */
export function selectionPickIDs(state: ActivitySelection, ids: number[]) {
  const eligibleIDs =
    state.eligibleIDs === null ? null : new Set(state.eligibleIDs);
  const selectedIDs = state.onlySelected ? new Set(state.selectedIDs) : null;
  return canonical(state, ids).filter(
    (id) =>
      (!eligibleIDs || eligibleIDs.has(id)) &&
      (!selectedIDs || selectedIDs.has(id)),
  );
}

function finish(
  state: ActivitySelection,
  rule: 'retain' | 'replace' | 'remove' = 'retain',
): ActivitySelection {
  // Normalize before validating inspection: clearing a restricted group restores
  // ordinary visibility, so an independently opened eligible detail stays open.
  const next = {
    ...state,
    onlySelected: state.onlySelected && state.selectedIDs.length > 0,
  };
  const eligibleIDs =
    next.eligibleIDs === null ? null : new Set(next.eligibleIDs);
  const visible = next.selectedIDs.filter(
    (id) => !eligibleIDs || eligibleIDs.has(id),
  );
  if (rule !== 'retain' && visible.length === 1) next.activeID = visible[0]!;
  else if (next.activeID !== null && !visible.includes(next.activeID))
    next.activeID = null;
  if (
    next.inspectedID !== null &&
    (!known(next, next.inspectedID) ||
      !eligible(next, next.inspectedID) ||
      (next.onlySelected && !next.selectedIDs.includes(next.inspectedID)))
  )
    next.inspectedID = null;
  return next;
}

export function selectionTransition(
  state: ActivitySelection,
  event: SelectionEvent,
): ActivitySelection {
  switch (event.type) {
    case 'set_combine':
      return { ...state, combine: event.enabled };
    case 'set_only_selected':
      return finish({ ...state, onlySelected: event.enabled });
    case 'reset_scope':
      return finish({ ...state, onlySelected: false });
    case 'clear_scope':
      return { ...emptySelection(), eligibleIDs: [], knownIDs: [] };
    case 'clear':
      return finish({
        ...state,
        selectedIDs: [],
        activeID: null,
        onlySelected: false,
      });
    case 'dismiss_inspection':
      return { ...state, inspectedID: null };
    case 'inspect':
      return known(state, event.id) &&
        eligible(state, event.id) &&
        (!state.onlySelected || state.selectedIDs.includes(event.id))
        ? { ...state, inspectedID: event.id }
        : state;
    case 'activate':
      return finish({ ...state, activeID: event.id });
    case 'show_on_map': {
      if (
        !event.hasGeometry ||
        !known(state, event.id) ||
        !eligible(state, event.id)
      )
        return state;
      const selectedIDs = state.combine
        ? canonical(state, [...state.selectedIDs, event.id])
        : [event.id];
      return finish({ ...state, selectedIDs, activeID: event.id });
    }
    case 'pick': {
      const hits = selectionPickIDs(state, event.ids);
      if (state.combine)
        return hits.length
          ? selectionTransition(state, { type: 'add', ids: hits })
          : state;
      return selectionTransition(state, { type: 'replace', ids: hits });
    }
    case 'toggle': {
      if (
        !state.combine ||
        !known(state, event.id) ||
        !eligible(state, event.id) ||
        (state.onlySelected && !state.selectedIDs.includes(event.id))
      )
        return state;
      return selectionTransition(state, {
        type: state.selectedIDs.includes(event.id) ? 'remove' : 'add',
        ids: [event.id],
      });
    }
    case 'update': {
      const selectedIDs = canonical(state, event.ids);
      const requested = new Set(selectedIDs);
      return finish(
        { ...state, selectedIDs },
        state.selectedIDs.some((id) => !requested.has(id))
          ? 'remove'
          : 'retain',
      );
    }
    case 'replace':
      return finish(
        { ...state, selectedIDs: canonical(state, event.ids) },
        'replace',
      );
    case 'add':
      return finish({
        ...state,
        selectedIDs: canonical(state, [...state.selectedIDs, ...event.ids]),
      });
    case 'remove': {
      const removed = new Set(event.ids);
      const selectedIDs = state.selectedIDs.filter((id) => !removed.has(id));
      return finish(
        { ...state, selectedIDs },
        selectedIDs.length !== state.selectedIDs.length ? 'remove' : 'retain',
      );
    }
    case 'reconcile': {
      const next = {
        ...state,
        knownIDs: event.knownIDs,
        eligibleIDs: event.eligibleIDs,
      };
      next.selectedIDs = canonical(next, state.selectedIDs);
      return finish(
        next,
        next.selectedIDs.length !== state.selectedIDs.length
          ? 'remove'
          : 'retain',
      );
    }
  }
}
