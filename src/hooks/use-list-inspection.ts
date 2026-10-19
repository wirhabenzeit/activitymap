'use client';

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

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

export function useListInspection() {
  const href = useSyncExternalStore(
    subscribeBrowsingHistory,
    browsingHistorySnapshot,
    browsingHistoryServerSnapshot,
  );
  const activeId = inspectedActivity(href ? new URL(href).search : '');
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setWidth(container.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Web resizing restores the split view as soon as the list has room.
  // Presentation follows width; the original history entry still owns Back.
  const presentation = detailPresentation(width ?? 0);

  const open = useCallback(
    (id: number) => openActivityInspection('list', id),
    [],
  );
  const close = useCallback(() => closeActivityInspection('list'), []);

  return {
    containerRef,
    activeId,
    presentation,
    ready: width !== null,
    open,
    close,
  };
}
