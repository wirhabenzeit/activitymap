'use client';

import { useCallback, useSyncExternalStore } from 'react';

import {
  detailPresentation,
  inspectedActivity,
} from '~/components/list/inspection';
import {
  browsingHistoryServerSnapshot,
  browsingHistorySnapshot,
  closeActivityInspection,
  openActivityInspection,
  subscribeBrowsingHistory,
} from '~/lib/browsing-history';

import { useElementSize } from './use-element-size';

export function useListInspection() {
  const href = useSyncExternalStore(
    subscribeBrowsingHistory,
    browsingHistorySnapshot,
    browsingHistoryServerSnapshot,
  );
  const activeId = inspectedActivity(href ? new URL(href).search : '');
  const [containerRef, { width, ready }] = useElementSize({ box: 'client' });

  // Web resizing restores the split view as soon as the list has room.
  // Presentation follows width; the original history entry still owns Back.
  const presentation = detailPresentation(width);

  const open = useCallback(
    (id: number) => openActivityInspection('list', id),
    [],
  );
  const close = useCallback(() => closeActivityInspection('list'), []);

  return {
    containerRef,
    activeId,
    presentation,
    ready,
    open,
    close,
  };
}
