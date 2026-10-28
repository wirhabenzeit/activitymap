'use client';

import { useMemo } from 'react';

import type { StreamMetadata } from '~/contracts/v1/activity-streams';
import type { Activity } from '~/lib/activity';
import {
  selectedMatchedPlaces,
  syncedActivityPlaces,
} from '~/lib/activity-places';
import { useShallowStore } from '~/store';

import { useLibrarySnapshot } from './use-library-snapshot';

const noActivityIds: number[] = [];

function usePlaceUser() {
  return useShallowStore((state) =>
    state.isInitialized && !state.isGuest && state.user?.stravaConnected
      ? state.user.id
      : undefined,
  );
}
/** Backend jobs own matching; results arrive with ordinary library sync. A
 * missing or pending bundle is awaiting processing, never an empty result. */
function useSyncedPlaces() {
  const { snapshot } = useLibrarySnapshot();
  const activities = useMemo(
    () =>
      new Map(snapshot?.activities.map((activity) => [activity.id, activity])),
    [snapshot?.activities],
  );
  return {
    activities,
    hydrated: snapshot?.loaded === true,
    version: snapshot?.syncState?.placeMatchingVersion,
  };
}
export function useActivityPlaces(
  activityId: string,
  metadata?: StreamMetadata,
) {
  const userId = usePlaceUser();
  const { activities, hydrated, version } = useSyncedPlaces();
  const saved = syncedActivityPlaces(
    activities.get(activityId),
    userId ?? '',
    version,
    metadata,
  );
  const data = saved && saved.status !== 'pending' ? saved : undefined;
  return {
    enabled: Boolean(userId),
    data,
    isLoading: Boolean(userId) && !hydrated,
    isAwaiting: Boolean(userId) && hydrated && !data,
  };
}
export function useSelectedActivityPlaces(
  activities: ReadonlyMap<number, Activity>,
  selectedIds: number[],
  overviewIds: number[] = noActivityIds,
) {
  const userId = usePlaceUser();
  const { activities: syncedActivities, hydrated, version } = useSyncedPlaces();
  const ids = useMemo(
    () =>
      [...new Set([...selectedIds, ...overviewIds])].filter((id) =>
        activities.has(id),
      ),
    [selectedIds, overviewIds, activities],
  );
  const results = useMemo(
    () =>
      ids.map((id) => {
        const result = syncedActivityPlaces(
          syncedActivities.get(String(id)),
          userId ?? '',
          version,
          activities.get(id)?.streamsMetadata,
        );
        return result?.status !== 'pending' ? result : undefined;
      }),
    [ids, syncedActivities, userId, version, activities],
  );
  const places = useMemo(
    () =>
      userId
        ? selectedMatchedPlaces(results, userId, new Set(ids.map(String)))
        : [],
    [results, userId, ids],
  );
  const selected = new Set(selectedIds.filter((id) => activities.has(id)));
  return {
    places,
    userId,
    isLoading: Boolean(userId) && !hydrated,
    // Only explicitly selected routes report progress; the overview stays quiet.
    awaitingCount: hydrated
      ? ids.filter((id, index) => selected.has(id) && !results[index]).length
      : 0,
    totalCount: selected.size,
  };
}
