'use client';

import { Marker } from 'react-map-gl/mapbox';
import { useQueryClient } from '@tanstack/react-query';
import { useElevationCursor } from '~/store/elevation-cursor';
import { useShallowStore } from '~/store';
import { useActivities } from '~/hooks/use-activities';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import { activityStreamMetadata } from '~/lib/sync/v1-mappers';
import {
  isStreamSummaryCurrent,
  streamSummaryQueryKey,
} from '~/lib/activity-stream-summary';

export function ElevationRouteMarker() {
  const cursor = useElevationCursor((state) => state.cursor);
  const { user, selected, highlighted, isGuest } = useShallowStore((state) => ({
    user: state.user,
    selected: state.selected,
    highlighted: state.highlighted,
    isGuest: state.isGuest,
  }));
  const { data: activities = [] } = useActivities();
  const { filterIDs } = useFilteredActivities(activities);
  const queryClient = useQueryClient();
  if (!cursor || isGuest || !user?.stravaConnected || cursor.userId !== user.id)
    return null;
  const id = Number(cursor.activityId);
  const activity = activities.find((activity) => activity.id === id);
  if (
    !activity ||
    !filterIDs.includes(id) ||
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
}
