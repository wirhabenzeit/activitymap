// The avatar's quiet loading indicator (#309). One logical interval covers the
// first page, every following page and a background sync, so the animation
// never restarts between batches. iOS mirrors these timings in
// BusyIndicatorState.swift.

export const INDICATOR_SHOW_AFTER_MS = 250;
export const INDICATOR_MINIMUM_VISIBLE_MS = 600;

/**
 * Busy while a page is in flight or another one is still due. A failed page
 * ends the interval, and a retry wait or offline phase is not downloading.
 */
export function isActivityLoadBusy(
  pages: {
    isFetching: boolean;
    hasNextPage: boolean;
    isError: boolean;
    isFetchNextPageError: boolean;
  },
  syncPhase: 'idle' | 'syncing' | 'ready' | 'offline' | 'error' | undefined,
) {
  const pagesBusy =
    pages.isFetching ||
    (pages.hasNextPage && !pages.isError && !pages.isFetchNextPageError);
  return pagesBusy || syncPhase === 'syncing';
}

export type IndicatorState = {
  visible: boolean;
  busySince: number | null;
  shownAt: number | null;
};

export const hiddenIndicator: IndicatorState = {
  visible: false,
  busySince: null,
  shownAt: null,
};

/**
 * Shows only after a short busy period, so cache-only loads never flash, and
 * then stays for a minimum time. Returns when to re-evaluate, if at all.
 */
export function advanceIndicator(
  state: IndicatorState,
  busy: boolean,
  now: number,
): { state: IndicatorState; wakeAt: number | null } {
  if (busy) {
    if (state.visible) {
      return { state, wakeAt: null };
    }
    const busySince = state.busySince ?? now;
    const showAt = busySince + INDICATOR_SHOW_AFTER_MS;
    if (now >= showAt) {
      return { state: { visible: true, busySince, shownAt: now }, wakeAt: null };
    }
    return { state: { ...state, busySince }, wakeAt: showAt };
  }
  if (state.visible && state.shownAt !== null) {
    const hideAt = state.shownAt + INDICATOR_MINIMUM_VISIBLE_MS;
    if (now < hideAt) {
      return { state: { ...state, busySince: null }, wakeAt: hideAt };
    }
  }
  return { state: hiddenIndicator, wakeAt: null };
}
