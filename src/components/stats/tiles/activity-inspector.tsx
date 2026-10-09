'use client';

import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { type Activity } from '~/server/db/schema';
import { ListDetailTransition } from '~/components/list/list-detail-transition';
import { detailPresentation } from '~/components/list/inspection';
import { Measure } from './charts';

const ActivityDetails = dynamic(() => import('./activity-details'), {
  ssr: false,
});

/** Keep the originating chart mounted while inspecting an activity. */
export function StatsActivityInspector({
  activities,
  preview = false,
  children,
}: {
  activities: Activity[];
  preview?: boolean;
  children: (
    open: (id: number) => void,
    detailsOpen: boolean,
    inspection: { availableWidth: number; selectedActivityId: number | null },
  ) => ReactNode;
}) {
  const [detailId, setDetailId] = useState<number | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const originId = useRef<number | null>(null);
  const findReturnFocus = useCallback(() => {
    // Responsive Records/Calendar layouts can replace the original button.
    return (
      [
        ...document.querySelectorAll<HTMLElement>(
          `[data-stats-activity-id="${originId.current}"]`,
        ),
      ].find(
        (element) =>
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility === 'visible',
      ) ?? null
    );
  }, []);
  useEffect(() => {
    const close = () => setDetailId(null);
    window.addEventListener('popstate', close);
    window.addEventListener('activitymap:stats-focus', close);
    return () => {
      window.removeEventListener('popstate', close);
      window.removeEventListener('activitymap:stats-focus', close);
    };
  }, []);
  const detail = activities.find((activity) => activity.id === detailId);
  const open = (id: number) => {
    originId.current = id;
    origin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDetailId(id);
  };
  return (
    <Measure retainSize className="h-full min-h-0 w-full">
      {({ width }) => (
        <ListDetailTransition
          detailId={detailId ?? 0}
          detail={
            detail ? (
              <ActivityDetails activity={detail} preview={preview} />
            ) : undefined
          }
          onBack={() => setDetailId(null)}
          backLabel="Back to stats"
          returnFocus={origin}
          findReturnFocus={findReturnFocus}
          presentation={detailPresentation(width)}
        >
          {children(open, Boolean(detail), {
            availableWidth: width,
            selectedActivityId: detail?.id ?? null,
          })}
        </ListDetailTransition>
      )}
    </Measure>
  );
}
