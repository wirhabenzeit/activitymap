'use client';

import { queryOptions, useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { StreamMetadata } from '~/contracts/v1/activity-streams';
import type { Activity } from '~/lib/activity';
import {
  activityPlacesQueryKey,
  selectedMatchedPlaces,
} from '~/lib/activity-places';
import {
  fetchActivityPlaces,
  prioritizeActivityPlaces,
} from '~/lib/activity-places-client';
import { useShallowStore } from '~/store';

function usePlaceUser() {
  return useShallowStore((state) =>
    state.isInitialized && !state.isGuest && state.user?.stravaConnected
      ? state.user.id
      : undefined,
  );
}
function options(
  userId: string | undefined,
  activityId: string,
  metadata?: StreamMetadata,
) {
  return queryOptions({
    queryKey: activityPlacesQueryKey(userId ?? '', activityId, metadata),
    enabled: Boolean(userId),
    queryFn: ({ signal }) =>
      fetchActivityPlaces({ userId: userId!, activityId, signal }),
    staleTime: 2 * 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
export function useActivityPlaces(
  activityId: string,
  metadata?: StreamMetadata,
) {
  const userId = usePlaceUser();
  const query = useQuery(options(userId, activityId, metadata));
  useEffect(() => {
    if (userId) prioritizeActivityPlaces(userId, activityId);
  }, [userId, activityId]);
  return {
    ...query,
    enabled: Boolean(userId),
    data: userId && !query.isError ? query.data : undefined,
  };
}
export function useSelectedActivityPlaces(
  activities: ReadonlyMap<number, Activity>,
  selectedIds: number[],
) {
  const userId = usePlaceUser();
  const ids = useMemo(
    () => selectedIds.filter((id) => activities.has(id)),
    [selectedIds, activities],
  );
  const queries = useQueries({
    queries: ids.map((id) =>
      options(userId, String(id), activities.get(id)?.streamsMetadata),
    ),
  });
  const selected = new Set(ids.map(String));
  return {
    places: userId
      ? selectedMatchedPlaces(
          queries.map((query) => (!query.isError ? query.data : undefined)),
          userId,
          selected,
        )
      : [],
    userId,
    isLoading: Boolean(userId) && queries.some((query) => query.isPending),
    isError: Boolean(userId) && queries.some((query) => query.isError),
    retry: () => {
      for (const query of queries) if (query.isError) void query.refetch();
    },
  };
}
