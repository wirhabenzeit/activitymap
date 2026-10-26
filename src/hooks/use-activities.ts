'use client';

import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { FeatureCollection } from 'geojson';
import { useEffect, useMemo } from 'react';

import { toActivityDTO } from '~/contracts/v1/activity';
import type { Activity } from '~/lib/activity';
import { createFeature } from '~/lib/activity-utils';
import { LEGACY_SHARING_ENABLED } from '~/lib/legacy-sharing';
import { libraryQueryState } from '~/lib/sync/library-query-state';
import { fetchAndPersistPage } from '~/lib/sync/persisted-page';
import {
  type ActivityWithStreams,
  dtoToActivity,
  dtoToActivityWithPlaces,
} from '~/lib/sync/v1-mappers';
import { getCachedActivityDTOs, upsertActivityDTOs } from '~/lib/sync/v1-store';
import {
  getPublicActivities,
  getPublicUserActivities,
} from '~/server/db/actions';
import type { Activity as LegacyActivity } from '~/server/db/schema';
import { useShallowStore } from '~/store';

import { useLibrarySnapshot } from './use-library-snapshot';

// Legacy guest reads remain separate from the authenticated owner. In
// particular, this adapter can never create an auth:* persistence scope.
const getCachedGuestActivities = async (
  scope: string,
): Promise<ActivityWithStreams[]> =>
  (await getCachedActivityDTOs(scope)).map(dtoToActivity);
const upsertCachedGuestActivities = (
  scope: string,
  activities: LegacyActivity[],
): Promise<void> => upsertActivityDTOs(scope, activities.map(toActivityDTO));

const selectActivities = (data: InfiniteData<Activity[], number>) =>
  data.pages.flat();

const buildGuestCacheScope = (params: {
  isGuest: boolean;
  guestType: 'user' | 'activities' | null;
  guestUserId?: string;
  guestActivityIds: number[];
}): string | null => {
  const { isGuest, guestType, guestUserId, guestActivityIds } = params;

  if (isGuest && guestType === 'user' && guestUserId) {
    return `guest:user:${guestUserId}`;
  }

  if (isGuest && guestType === 'activities' && guestActivityIds.length > 0) {
    return `guest:activities:${guestActivityIds.join(',')}`;
  }

  return null;
};

const buildGuestActivitiesQueryKey = (params: {
  isGuest: boolean;
  guestType: 'user' | 'activities' | null;
  guestUserId: string | null;
  guestActivityIds: number[];
}) =>
  [
    'activities',
    params.isGuest ? 'guest' : 'auth',
    null, // Keep the unauthenticated development-gallery observer key.
    params.guestType,
    params.guestUserId,
    params.guestActivityIds.join(','),
  ] as const;

export function useActivities() {
  const queryClient = useQueryClient();
  const library = useLibrarySnapshot();
  const { isInitialized, isGuest, guestMode } = useShallowStore((state) => ({
    isInitialized: state.isInitialized,
    isGuest: state.isGuest,
    guestMode: state.guestMode,
  }));
  const guestActivityIds = useMemo(
    () => guestMode.activityIds ?? [],
    [guestMode.activityIds],
  );
  // Legacy sharing (`/map?activities=`/`/map?user=`) is disabled - Part of
  // #132, see `~/lib/legacy-sharing.ts` and docs/strava-data-policy.md §5.
  // These stay `false` while the flag is off so a guest-mode visit never
  // calls the now-disabled `getPublicActivities`/`getPublicUserActivities`
  // server actions at all.
  const canFetchGuestActivities =
    LEGACY_SHARING_ENABLED &&
    isGuest &&
    guestMode.type === 'activities' &&
    guestActivityIds.length > 0;
  const canFetchGuestUser =
    LEGACY_SHARING_ENABLED &&
    isGuest &&
    guestMode.type === 'user' &&
    !!guestMode.userId;
  const canFetchActivities =
    isInitialized && (canFetchGuestActivities || canFetchGuestUser);
  const cacheScope = useMemo(
    () =>
      buildGuestCacheScope({
        isGuest,
        guestType: guestMode.type,
        guestUserId: guestMode.userId ?? undefined,
        guestActivityIds,
      }),
    [isGuest, guestMode.type, guestMode.userId, guestActivityIds],
  );
  const queryKey = useMemo(
    () =>
      buildGuestActivitiesQueryKey({
        isGuest,
        guestType: guestMode.type,
        guestUserId: guestMode.userId ?? null,
        guestActivityIds,
      }),
    [isGuest, guestMode.type, guestMode.userId, guestActivityIds],
  );
  const query = useInfiniteQuery({
    queryKey,
    // Only legacy guests page here. Authenticated downloads and writes
    // belong exclusively to the library sync coordinator.
    queryFn: ({ pageParam }) =>
      fetchAndPersistPage({
        fetchPage: () => {
          if (canFetchGuestActivities) {
            return getPublicActivities(guestActivityIds);
          }

          if (canFetchGuestUser) {
            return getPublicUserActivities({
              userId: guestMode.userId!,
              offset: pageParam,
              limit: 500,
            });
          }

          return Promise.resolve([]);
        },
        persistPage: (page) =>
          cacheScope
            ? upsertCachedGuestActivities(cacheScope, page)
            : Promise.resolve(),
        onPersistenceError: (error) => {
          console.error(
            'Failed to persist activities in IndexedDB cache:',
            error,
          );
        },
      }),
    enabled: canFetchActivities,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (canFetchGuestActivities) {
        return undefined;
      }

      if (lastPage.length < 500) return undefined;
      return allPages.length * 500;
    },
    select: selectActivities,
    // Data is valid forever until explicitly invalidated (local-first)
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const cacheQuery = useQuery({
    queryKey: ['activities-cache', cacheScope],
    queryFn: () => {
      if (!cacheScope) return Promise.resolve([]);
      return getCachedGuestActivities(cacheScope);
    },
    enabled: !!cacheScope,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!cacheScope || !cacheQuery.data || cacheQuery.data.length === 0) {
      return;
    }

    queryClient.setQueryData<InfiniteData<Activity[], number>>(
      queryKey,
      (current) =>
        current ?? {
          pages: [cacheQuery.data],
          pageParams: [0],
        },
    );
  }, [cacheQuery.data, cacheScope, queryClient, queryKey]);

  const data = query.data ?? cacheQuery.data;

  const activityDTOs = library.snapshot?.activities;
  const loaded = library.snapshot?.loaded;
  const matchingVersion = library.snapshot?.syncState?.placeMatchingVersion;
  const placeUserId = useShallowStore((state) =>
    !state.isGuest && state.user?.stravaConnected ? state.user.id : undefined,
  );
  const authenticatedData = useMemo(
    () =>
      loaded && activityDTOs
        ? activityDTOs.map((dto) =>
            dtoToActivityWithPlaces(dto, placeUserId ?? '', matchingVersion),
          )
        : undefined,
    [loaded, activityDTOs, placeUserId, matchingVersion],
  );
  const authenticatedState = useMemo(
    () =>
      libraryQueryState(
        library.snapshot,
        library.sync,
        authenticatedData?.length ?? 0,
      ),
    [library.snapshot, library.sync, authenticatedData?.length],
  );
  // A search-only render must not publish a new browsing-context value before
  // its deferred projection changes. Preserve query identity for that pass.
  const authenticatedQuery = useMemo(
    () => ({
      ...authenticatedState,
      data: authenticatedData,
      refetch: library.refetch,
      fetchNextPage: library.refetch,
    }),
    [authenticatedState, authenticatedData, library.refetch],
  );
  if (library.scope) return authenticatedQuery;

  // Streaming logic moved to <ActivityStreamer /> to avoid duplicate fetches
  // when this hook is used in multiple components.

  return {
    ...query,
    data,
  };
}

export function useActivityGeoJson() {
  const { data: activities } = useActivities();

  return useActivityGeoJsonFromActivities(activities);
}

export function useActivityGeoJsonFromActivities(
  activities: Activity[] | undefined,
) {
  return useMemo<FeatureCollection>(() => {
    if (!activities) return { type: 'FeatureCollection', features: [] };

    return {
      type: 'FeatureCollection',
      features: activities
        .filter((act) => act.map_polyline ?? act.map_summary_polyline)
        .map(createFeature),
    };
  }, [activities]);
}
