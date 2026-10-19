import { activityURL, inspectedActivity } from '~/components/list/inspection';
import { focusedTile, tileFocusURL } from '~/components/stats/tiles/focus';
import type { StatsTileID } from '~/settings/stats-tiles.generated';

type Surface = 'list' | 'stats';
type HistoryMetadata = {
  activityListDetail?: { returnTo: string };
  statsActivityDetail?: { returnTo: string };
  statsTileFocus?: { dashboardURL: string };
};
type Listener = (reason: 'pop' | 'change') => void;
const listeners = new Set<Listener>();
const notify = (reason: 'pop' | 'change') => {
  for (const listener of listeners) listener(reason);
};
const pop = () => notify('pop');

/** One native listener, regardless of how many browsing surfaces subscribe. */
export function subscribeBrowsingHistory(listener: Listener) {
  if (!listeners.size) window.addEventListener('popstate', pop);
  listeners.add(listener);
  return () => {
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Set membership, not SQL.
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('popstate', pop);
  };
}
export const browsingHistorySnapshot = () => window.location.href;
export const browsingHistoryServerSnapshot = () => '';

function metadata(): HistoryMetadata {
  const state: unknown = window.history.state;
  if (!state || typeof state !== 'object') return {};
  const result: HistoryMetadata = {};
  if ('activityListDetail' in state && validReturn(state.activityListDetail))
    result.activityListDetail = state.activityListDetail;
  if ('statsActivityDetail' in state && validReturn(state.statsActivityDetail))
    result.statsActivityDetail = state.statsActivityDetail;
  if (
    'statsTileFocus' in state &&
    state.statsTileFocus &&
    typeof state.statsTileFocus === 'object' &&
    'dashboardURL' in state.statsTileFocus &&
    typeof state.statsTileFocus.dashboardURL === 'string'
  )
    result.statsTileFocus = { dashboardURL: state.statsTileFocus.dashboardURL };
  return result;
}
function validReturn(value: unknown): value is { returnTo: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    'returnTo' in value &&
    typeof value.returnTo === 'string'
  );
}
function write(
  mode: 'push' | 'replace',
  href: string,
  state: HistoryMetadata = {},
) {
  // Never forward Next's __NA flag: its supported native integration copies
  // internals itself, while forwarding that flag bypasses URL notification.
  if (mode === 'push') window.history.pushState(state, '', href);
  else window.history.replaceState(state, '', href);
  notify('change');
}
const inspectionKey = (surface: Surface) =>
  surface === 'list' ? 'activityListDetail' : 'statsActivityDetail';
export function openActivityInspection(surface: Surface, id: number) {
  const current = inspectedActivity(window.location.search);
  if (current === id) return;
  const state = metadata();
  if (!current)
    state[inspectionKey(surface)] = {
      returnTo: activityURL(window.location.href, 0),
    };
  // Stepping replaces one inspection session; direct links gain no invented parent.
  write(
    current ? 'replace' : 'push',
    activityURL(window.location.href, id),
    state,
  );
}
export function closeActivityInspection(surface: Surface) {
  const state = metadata();
  if (state[inspectionKey(surface)]?.returnTo) window.history.back();
  else {
    state[inspectionKey(surface)] = undefined;
    write('replace', activityURL(window.location.href, 0), state);
  }
}
export function openTileFocus(id: StatsTileID) {
  write('push', tileFocusURL(window.location.href, id), {
    statsTileFocus: { dashboardURL: tileFocusURL(window.location.href, null) },
  });
}
export function focusCloseTarget() {
  const state = metadata();
  if (
    inspectedActivity(window.location.search) &&
    !state.statsActivityDetail?.returnTo
  )
    return 'inspection';
  if (state.statsActivityDetail?.returnTo || state.statsTileFocus?.dashboardURL)
    return 'back';
  return 'dashboard';
}
export function closeTileFocus() {
  switch (focusCloseTarget()) {
    case 'inspection':
      closeActivityInspection('stats');
      break;
    case 'back':
      window.history.back();
      break;
    case 'dashboard':
      write('replace', tileFocusURL(window.location.href, null));
      break;
  }
}
export const currentFocusedTile = () => focusedTile(window.location.search);
