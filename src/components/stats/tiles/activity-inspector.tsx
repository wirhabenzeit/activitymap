'use client';

import dynamic from 'next/dynamic';
import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { type Activity } from '~/server/db/schema';
import { ListDetailTransition } from '~/components/list/list-detail-transition';
import {
  activityURL,
  detailPresentation,
  inspectedActivity,
} from '~/components/list/inspection';
import { Measure } from './charts';

const ActivityDetails = dynamic(() => import('./activity-details'), {
  ssr: false,
});

type StatsHistory = {
  statsTileFocus?: { dashboardURL: string };
  statsActivityDetail?: { returnTo: string };
};
const inspectionChanged = 'activitymap:stats-inspection';
const snapshot = () => inspectedActivity(window.location.search) || null;
const serverSnapshot = () => null;
function subscribe(notify: () => void) {
  window.addEventListener('popstate', notify);
  window.addEventListener(inspectionChanged, notify);
  window.addEventListener('activitymap:stats-focus', notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener(inspectionChanged, notify);
    window.removeEventListener('activitymap:stats-focus', notify);
  };
}

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
  const detailId = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
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
  const close = useCallback(() => {
    const state = window.history.state as StatsHistory | null;
    if (state?.statsActivityDetail?.returnTo) window.history.back();
    else {
      window.history.replaceState(
        { statsTileFocus: state?.statsTileFocus },
        '',
        activityURL(window.location.href, 0),
      );
      window.dispatchEvent(new Event(inspectionChanged));
    }
  }, []);
  const detail = activities.find((activity) => activity.id === detailId);
  const open = (id: number) => {
    originId.current = id;
    origin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (detailId === id) return;
    const state = window.history.state as StatsHistory | null;
    // One entry per inspection session at every width. Choosing another row
    // replaces that entry so Back returns to the originating chart in one step.
    const metadata = {
      statsTileFocus: state?.statsTileFocus,
      statsActivityDetail: state?.statsActivityDetail ?? {
        returnTo: activityURL(window.location.href, 0),
      },
    };
    if (detailId)
      window.history.replaceState(
        metadata,
        '',
        activityURL(window.location.href, id),
      );
    else
      window.history.pushState(
        metadata,
        '',
        activityURL(window.location.href, id),
      );
    window.dispatchEvent(new Event(inspectionChanged));
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
          onBack={close}
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
