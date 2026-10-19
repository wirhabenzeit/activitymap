'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import {
  closeTileFocus,
  currentFocusedTile,
  focusCloseTarget,
  openTileFocus,
  subscribeBrowsingHistory,
} from '~/lib/browsing-history';
import { type StatsTileID } from '~/settings/stats-tiles.generated';

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

const snapshot = currentFocusedTile;
const serverSnapshot = () => null;
function subscribe(notify: () => void) {
  let previous = snapshot();
  return subscribeBrowsingHistory((reason) => {
    const next = snapshot();
    if (reason === 'pop' && next !== previous)
      changeView(next ?? previous, notify);
    else notify();
    previous = next;
  });
}

export function useStatsFocus() {
  const activeID = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const open = useCallback((id: StatsTileID) => {
    if (snapshot() !== id) changeView(id, () => openTileFocus(id));
  }, []);
  const close = useCallback(() => {
    if (focusCloseTarget() === 'dashboard')
      changeView(snapshot(), closeTileFocus);
    else closeTileFocus();
  }, []);
  return { activeID, open, close };
}
