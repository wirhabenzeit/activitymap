'use client';

import {
  queryOptions,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { StreamMetadata } from '~/contracts/v1/activity-streams';
import type { Activity } from '~/lib/activity';
import {
  activityPlacesQueryKey,
  selectedMatchedPlaces,
  syncedActivityPlaces,
} from '~/lib/activity-places';
import {
  fetchActivityPlaces,
  prioritizeActivityPlaces,
} from '~/lib/activity-places-client';
import {
  LibrarySyncNotReadyError,
  requestLibrarySync,
} from '~/lib/sync/library-sync';
import { getV1SyncState } from '~/lib/sync/v1-store';
import { useShallowStore } from '~/store';

import { useLibrarySnapshot } from './use-library-snapshot';

function usePlaceUser() {
  return useShallowStore((state) =>
    state.isInitialized && !state.isGuest && state.user?.stravaConnected
      ? state.user.id
      : undefined,
  );
}
function useMatchingVersion(userId: string | undefined, enabled = true) {
  const { snapshot } = useLibrarySnapshot();
  const syncedVersion = snapshot?.syncState?.placeMatchingVersion;
  const client = useQueryClient();
  const query = useQuery({
    initialData: syncedVersion,
    queryKey: [
      'library',
      `auth:${userId ?? ''}`,
      'place-matching-version',
      syncedVersion ?? null,
    ],
    enabled: Boolean(userId) && enabled,
    queryFn: async ({ signal }) => {
      // Use the existing serialized library writer for background catch-up.
      // It persists results and the manifest before this query exposes them.
      try {
        await requestLibrarySync(client, `auth:${userId}`);
      } catch (error) {
        if (!(error instanceof LibrarySyncNotReadyError)) throw error;
      }
      signal.throwIfAborted();
      const state = await getV1SyncState(`auth:${userId}`);
      if (state?.placeMatchingVersion) return state.placeMatchingVersion;
      // Compatibility with a server that predates place bundles in sync.
      const response = await fetch('/api/places/version', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      });
      if (!response.ok)
        throw new Error('Places could not be loaded. Try again.');
      const data = (await response.json()) as { version?: unknown };
      if (
        typeof data.version !== 'string' ||
        !/^[0-9a-f]{64}$/.test(data.version)
      )
        throw new Error('Invalid matching version');
      return data.version;
    },
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: 'always',
    retry: false,
  });
  return { ...query, isError: query.isError && !query.data };
}
function useSyncedPlaces() {
  const { snapshot } = useLibrarySnapshot();
  const activities = useMemo(
    () =>
      new Map(snapshot?.activities.map((activity) => [activity.id, activity])),
    [snapshot?.activities],
  );
  return { activities, hydrated: snapshot?.loaded === true };
}
function options(
  userId: string | undefined,
  activityId: string,
  metadata?: StreamMetadata,
  version?: string,
  pollIntervalMs = 3_000,
  synced = false,
) {
  return queryOptions({
    queryKey: activityPlacesQueryKey(
      userId ?? '',
      activityId,
      metadata,
      version,
    ),
    enabled: Boolean(userId && version) && !synced,
    queryFn: ({ signal }) =>
      fetchActivityPlaces({ userId: userId!, activityId, signal }),
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? pollIntervalMs : false,
    gcTime: 15 * 60_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
}
export function useActivityPlaces(
  activityId: string,
  metadata?: StreamMetadata,
) {
  const userId = usePlaceUser();
  const version = useMatchingVersion(userId);
  const client = useQueryClient();
  const { activities, hydrated } = useSyncedPlaces();
  const saved = syncedActivityPlaces(
    activities.get(activityId),
    userId ?? '',
    version.data,
    metadata,
  );
  const settled = saved && saved.status !== 'pending' ? saved : undefined;
  const query = useQuery(
    options(
      userId,
      activityId,
      metadata,
      version.data,
      3_000,
      !hydrated || Boolean(settled),
    ),
  );
  const versionChanged = Boolean(
    !settled &&
    query.data?.matchingVersion &&
    query.data.matchingVersion !== version.data,
  );
  useEffect(() => {
    if (versionChanged)
      void client.invalidateQueries({
        queryKey: ['library', `auth:${userId}`, 'place-matching-version'],
      });
  }, [client, userId, versionChanged]);
  useEffect(() => {
    if (userId) prioritizeActivityPlaces(userId, activityId);
  }, [userId, activityId]);
  return {
    ...query,
    enabled: Boolean(userId),
    isError: (!settled && query.isError) || version.isError,
    isFetching:
      Boolean(userId) &&
      !settled &&
      (!hydrated ||
        query.isFetching ||
        version.isPending ||
        query.data?.status === 'pending'),
    data:
      settled ??
      (userId && !query.isError && !version.isError && !versionChanged
        ? (query.data ?? saved)
        : undefined),
    refetch: () => (version.isError ? version.refetch() : query.refetch()),
  };
}
export function useSelectedActivityPlaces(
  activities: ReadonlyMap<number, Activity>,
  selectedIds: number[],
) {
  const userId = usePlaceUser();
  const version = useMatchingVersion(userId, selectedIds.length > 0);
  const client = useQueryClient();
  const ids = useMemo(
    () => selectedIds.filter((id) => activities.has(id)),
    [selectedIds, activities],
  );
  const { activities: syncedActivities, hydrated } = useSyncedPlaces();
  const saved = ids.map((id) =>
    syncedActivityPlaces(
      syncedActivities.get(String(id)),
      userId ?? '',
      version.data,
      activities.get(id)?.streamsMetadata,
    ),
  );
  const settled = saved.map((result) =>
    result?.status !== 'pending' ? result : undefined,
  );
  const queries = useQueries({
    queries: ids.map((id, index) =>
      options(
        userId,
        String(id),
        activities.get(id)?.streamsMetadata,
        version.data,
        Math.max(3_000, ids.length * 2_000),
        !hydrated || Boolean(settled[index]),
      ),
    ),
  });
  const selected = new Set(ids.map(String));
  const versionChanged = queries.some(
    (query, index) =>
      !settled[index] &&
      query.data?.matchingVersion &&
      query.data.matchingVersion !== version.data,
  );
  useEffect(() => {
    if (versionChanged)
      void client.invalidateQueries({
        queryKey: ['library', `auth:${userId}`, 'place-matching-version'],
      });
  }, [client, userId, versionChanged]);
  return {
    places:
      userId && !version.isError
        ? selectedMatchedPlaces(
            queries.map(
              (query, index) =>
                settled[index] ??
                (!query.isError &&
                (!query.data?.matchingVersion ||
                  query.data.matchingVersion === version.data)
                  ? query.data
                  : undefined),
            ),
            userId,
            selected,
          )
        : [],
    userId,
    isLoading:
      Boolean(userId) &&
      (!hydrated ||
        version.isPending ||
        queries.some(
          (query, index) =>
            !settled[index] &&
            (query.isFetching || query.data?.status === 'pending'),
        )),
    pendingCount: queries.filter(
      (query, index) =>
        !settled[index] &&
        (query.isFetching ||
          query.isPending ||
          query.data?.status === 'pending'),
    ).length,
    totalCount: ids.length,
    isError:
      Boolean(userId) &&
      (version.isError ||
        queries.some((query, index) => !settled[index] && query.isError)),
    retry: () => {
      if (version.isError) void version.refetch();
      for (const query of queries) if (query.isError) void query.refetch();
    },
  };
}
