'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { focusedTile, tileFocusURL } from '~/components/stats/tiles/focus';
import { type StatsTileID } from '~/settings/stats-tiles.generated';

type FocusHistory = { statsTileFocus?: { dashboardURL: string } };
const changed = 'activitymap:stats-focus';

let transition: ViewTransition | undefined;

function clearParticipants() {
  document
    .querySelectorAll<HTMLElement>('[data-stats-transition-tile]')
    .forEach((element) => {
      element.style.viewTransitionName = '';
      delete element.dataset.statsTransitionTile;
    });
}

function participant(id: StatsTileID) {
  const focus = document.querySelector<HTMLElement>(
    `[data-stats-focus="${id}"]`,
  );
  return focus?.getClientRects().length
    ? focus
    : document.querySelector<HTMLElement>(`[data-tile-id="${id}"]`);
}

// Snapshot the old and new surfaces, rather than resizing live charts or
// moving dashboard neighbors. No animation is needed on unsupported browsers.
function changeView(id: StatsTileID | null, update: () => void) {
  if (
    !id ||
    !document.startViewTransition ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    flushSync(update);
    return;
  }
  transition?.skipTransition();
  clearParticipants();
  const name = () => {
    const element = participant(id);
    if (!element) return;
    element.style.viewTransitionName = 'stats-focused-tile';
    element.dataset.statsTransitionTile = '';
  };
  name();
  document.documentElement.dataset.statsTransition = '';
  const current = document.startViewTransition(() => {
    flushSync(update);
    // The dashboard is visibility-hidden to preserve its layout/scroll, so
    // clear its old name before naming the destination (one participant only).
    clearParticipants();
    name();
  });
  transition = current;
  const cleanup = () => {
    if (transition !== current) return;
    transition = undefined;
    delete document.documentElement.dataset.statsTransition;
    clearParticipants();
  };
  void current.finished.then(cleanup, cleanup);
}

const snapshot = () => focusedTile(window.location.search);
const serverSnapshot = () => null;
function subscribe(notify: () => void) {
  let previous = snapshot();
  const pop = () => {
    const next = snapshot();
    if (next === previous) notify();
    else changeView(next ?? previous, notify);
    previous = next;
  };
  const update = () => {
    previous = snapshot();
    notify();
  };
  window.addEventListener('popstate', pop);
  window.addEventListener(changed, update);
  return () => {
    window.removeEventListener('popstate', pop);
    window.removeEventListener(changed, update);
  };
}

export function useStatsFocus() {
  // Next's native history integration updates the URL without navigating or
  // remounting this dashboard. This subscription also covers browser Forward.
  const activeID = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const open = useCallback((id: StatsTileID) => {
    if (snapshot() === id) return;
    changeView(id, () => {
      window.history.pushState(
        {
          statsTileFocus: {
            dashboardURL: tileFocusURL(window.location.href, null),
          },
        },
        '',
        tileFocusURL(window.location.href, id),
      );
      window.dispatchEvent(new Event(changed));
    });
  }, []);
  const close = useCallback(() => {
    const state = window.history.state as FocusHistory | null;
    if (state?.statsTileFocus?.dashboardURL) {
      window.history.back();
    } else {
      // A direct/reloaded focus URL has no originating dashboard entry.
      // Return locally instead of sending the user out of the app.
      changeView(snapshot(), () => {
        window.history.replaceState(
          null,
          '',
          tileFocusURL(window.location.href, null),
        );
        window.dispatchEvent(new Event(changed));
      });
    }
  }, []);
  return { activeID, open, close };
}
