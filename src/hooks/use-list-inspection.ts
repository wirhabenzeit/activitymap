'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  activityURL,
  detailPresentation,
  inspectedActivity,
} from '~/components/list/inspection';

type InspectionHistory = {
  activityListDetail?: { returnTo: string };
};

export function useListInspection() {
  const search = useSearchParams();
  const activeId = inspectedActivity(search.toString());
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
    (id: number) => {
      const href = activityURL(window.location.href, id);
      if (!activeId && presentation === 'push') {
        window.history.pushState(
          {
            activityListDetail: {
              returnTo: activityURL(window.location.href, 0),
            },
          },
          '',
          href,
        );
      } else {
        const state = window.history.state as InspectionHistory | null;
        // Pass only our metadata: passing Next's __NA flag bypasses its URL
        // notification. Next copies its internal history state automatically.
        window.history.replaceState(
          { activityListDetail: state?.activityListDetail },
          '',
          href,
        );
      }
    },
    [activeId, presentation],
  );

  const close = useCallback(() => {
    const state = window.history.state as InspectionHistory | null;
    if (state?.activityListDetail?.returnTo) {
      window.history.back();
    } else {
      window.history.replaceState(
        null,
        '',
        activityURL(window.location.href, 0),
      );
    }
  }, []);

  return {
    containerRef,
    activeId,
    presentation,
    ready: width !== null,
    open,
    close,
  };
}
