'use client';

import { useQueryClient } from '@tanstack/react-query';
import { memo } from 'react';
import { Marker } from 'react-map-gl/mapbox';

import type { Activity } from '~/lib/activity';
import {
  isStreamSummaryCurrent,
  streamSummaryQueryKey,
} from '~/lib/activity-stream-summary';
import { activityStreamMetadata } from '~/lib/sync/v1-mappers';
import { useShallowStore } from '~/store';
import { useElevationCursor } from '~/store/elevation-cursor';

// Memoized like RouteLayer: the map re-renders on every camera frame, while
// this marker only depends on the cursor, selection and filters.
export const ElevationRouteMarker = memo(function ElevationRouteMarker({
  activities,
  visibleIDs,
}: {
  activities: ReadonlyMap<number, Activity>;
  visibleIDs: ReadonlySet<number>;
}) {
  const cursor = useElevationCursor((state) => state.cursor);
  const { user, selected, highlighted, isGuest } = useShallowStore((state) => ({
    user: state.user,
    selected: state.selected,
    highlighted: state.highlighted,
    isGuest: state.isGuest,
  }));
  const queryClient = useQueryClient();
  if (!cursor || isGuest || !user?.stravaConnected || cursor.userId !== user.id)
    return null;
  const id = Number(cursor.activityId);
  const activity = activities.get(id);
  if (
    !activity ||
    !visibleIDs.has(id) ||
    !selected.includes(id) ||
    (selected.length > 1 && highlighted !== id) ||
    !isStreamSummaryCurrent(cursor.source, activityStreamMetadata(activity)) ||
    queryClient.getQueryData(
      streamSummaryQueryKey(cursor.userId, cursor.activityId),
    ) !== cursor.source
  )
    return null;
  return (
    <Marker
      latitude={cursor.coordinate[0]}
      longitude={cursor.coordinate[1]}
      anchor="center"
    >
      <div
        aria-hidden="true"
        data-testid="elevation-route-marker"
        className="pointer-events-none size-4 rounded-full border-2 border-white bg-[var(--activity-accent)] shadow-md"
      />
    </Marker>
  );
});
