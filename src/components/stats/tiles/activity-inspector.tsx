'use client';

import dynamic from 'next/dynamic';
import {
  type ReactNode,
  useCallback,
  useRef,
  useSyncExternalStore,
} from 'react';

import {
  detailPresentation,
  inspectedActivity,
} from '~/components/list/inspection';
import { ListDetailTransition } from '~/components/list/list-detail-transition';
import { useShowOnMap } from '~/hooks/use-show-on-map';
import {
  browsingHistoryServerSnapshot,
  browsingHistorySnapshot,
  closeActivityInspection,
  openActivityInspection,
  subscribeBrowsingHistory,
} from '~/lib/browsing-history';
import { type Activity } from '~/server/db/schema';
import { statsTiles } from '~/settings/stats-tiles.generated';
import { useShallowStore } from '~/store';
import { applyFilters } from '~/store/filter';

import { Measure } from './charts';
import { focusedTile } from './focus';

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
  const showOnMap = useShowOnMap(activities);
  const href = useSyncExternalStore(
    subscribeBrowsingHistory,
    browsingHistorySnapshot,
    browsingHistoryServerSnapshot,
  );
  const detailId = inspectedActivity(href ? new URL(href).search : '') || null;
  const tile =
    typeof window === 'undefined' ? null : focusedTile(window.location.search);
  const title =
    statsTiles.find((item) => item.id === tile)?.title ?? 'stats dashboard';
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
  const close = useCallback(() => closeActivityInspection('stats'), []);
  const detail = activities.find((activity) => activity.id === detailId);
  const mapActionVariant = useShallowStore((state) =>
    detail && !applyFilters(state, detail) ? 'clear-filters-and-show' : 'show',
  );
  const open = (id: number) => {
    originId.current = id;
    origin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    openActivityInspection('stats', id);
  };
  return (
    <Measure retainSize className="h-full min-h-0 w-full">
      {({ width }) => (
        <ListDetailTransition
          detailId={detailId ?? 0}
          detail={
            detail ? (
              <ActivityDetails
                activity={detail}
                preview={preview}
                onShowOnMap={showOnMap}
                mapActionVariant={mapActionVariant}
              />
            ) : undefined
          }
          onBack={close}
          backLabel={`Back to ${title}`}
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
