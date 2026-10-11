import type { StoreApi } from 'zustand';
import type { RootState } from '~/store';
import type { Activity } from '~/server/db/schema';
import { applyFilters } from '~/store/filter';
import { routeBounds, routeCoordinates } from './route-framing';

/** Explicit filter clearing must happen before activating the destination. */
export function showActivityOnMap(
  store: Pick<StoreApi<RootState>, 'getState'>,
  activity: Activity,
  activities: Activity[],
  clearFilters: boolean,
): 'shown' | 'hidden' | 'no-route' | 'unavailable' {
  let state = store.getState();
  if (state.knownSelectionIDs && !state.knownSelectionIDs.includes(activity.id))
    return 'unavailable';
  if (!routeBounds(routeCoordinates(activity))) return 'no-route';
  if (!applyFilters(state, activity)) {
    if (!clearFilters) return 'hidden';
    state.resetFilters();
    state = store.getState();
  }
  // Filter reconciliation normally runs in an effect. Do it now so the
  // explicit action cannot lose focus to the previous visibility snapshot.
  state.reconcileSelection(
    state.knownSelectionIDs,
    activities
      .filter((item) => applyFilters(state, item))
      .map((item) => item.id),
  );
  state.setSelected((selected) =>
    selected.includes(activity.id) ? selected : [...selected, activity.id],
  );
  state.setHighlighted(activity.id);
  state.requestRouteFit([activity.id]);
  return 'shown';
}
