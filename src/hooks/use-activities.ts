"use client";

import {
    type InfiniteData,
    useInfiniteQuery,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import {
    getPublicActivities,
    getPublicUserActivities,
    getUserActivities,
} from '~/server/db/actions';
import { createFeature } from '~/lib/activity-utils';
import { useEffect, useMemo } from 'react';
import type { FeatureCollection } from 'geojson';
import { useShallowStore } from '~/store';
import type { Activity } from '~/server/db/schema';
import { toActivityDTO } from '~/contracts/v1/activity';
import { getCachedActivityDTOs, upsertActivityDTOs } from '~/lib/sync/v1-store';
import { dtoToActivity, type ActivityWithStreams } from '~/lib/sync/v1-mappers';
import { LEGACY_SHARING_ENABLED } from '~/lib/legacy-sharing';
import { fetchAndPersistPage } from '~/lib/sync/persisted-page';

// Issue #126 (phase 2): this cache used to read/write
// `~/lib/offline/db.ts`'s Drizzle-shaped `Activity` rows directly. It now
// goes through the v1 sync adapters' DTO-typed store instead - converting
// at this boundary via `toActivityDTO`/`dtoToActivity` - so the local
// cache's own persisted type is `~/contracts/v1/activity.ts`'s
// `ActivityDTO`, not a Drizzle model, while every consumer of this hook
// keeps seeing plain `Activity[]` exactly as before.
const getCachedActivities = async (scope: string): Promise<ActivityWithStreams[]> =>
    (await getCachedActivityDTOs(scope)).map(dtoToActivity);
const upsertCachedActivities = (scope: string, activities: Activity[]): Promise<void> =>
    upsertActivityDTOs(scope, activities.map(toActivityDTO));

const selectActivities = (data: InfiniteData<Activity[], number>) => data.pages.flat();

const buildCacheScope = (params: {
    isGuest: boolean;
    userId?: string;
    guestType: 'user' | 'activities' | null;
    guestUserId?: string;
    guestActivityIds: number[];
}): string | null => {
    const { isGuest, userId, guestType, guestUserId, guestActivityIds } = params;

    if (!isGuest && userId) {
        return `auth:${userId}`;
    }

    if (isGuest && guestType === 'user' && guestUserId) {
        return `guest:user:${guestUserId}`;
    }

    if (isGuest && guestType === 'activities' && guestActivityIds.length > 0) {
        return `guest:activities:${guestActivityIds.join(',')}`;
    }

    return null;
};

const buildActivitiesQueryKey = (params: {
    isGuest: boolean;
    userId: string | null;
    guestType: 'user' | 'activities' | null;
    guestUserId: string | null;
    guestActivityIds: number[];
}) =>
    [
        'activities',
        params.isGuest ? 'guest' : 'auth',
        params.userId,
        params.guestType,
        params.guestUserId,
        params.guestActivityIds.join(','),
    ] as const;

export function useActivities() {
    const queryClient = useQueryClient();
    const { userId, isInitialized, isGuest, guestMode } = useShallowStore((state) => ({
        userId: state.user?.id,
        isInitialized: state.isInitialized,
        isGuest: state.isGuest,
        guestMode: state.guestMode,
    }));
    const guestActivityIds = useMemo(
        () => guestMode.activityIds ?? [],
        [guestMode.activityIds],
    );
    const canFetchAuthenticatedData = !!userId && !isGuest;
    // Legacy sharing (`/map?activities=`/`/map?user=`) is disabled - Part of
    // #132, see `~/lib/legacy-sharing.ts` and docs/strava-data-policy.md §5.
    // These stay `false` while the flag is off so a guest-mode visit never
    // calls the now-disabled `getPublicActivities`/`getPublicUserActivities`
    // server actions at all.
    const canFetchGuestActivities =
        LEGACY_SHARING_ENABLED &&
        isGuest && guestMode.type === 'activities' && guestActivityIds.length > 0;
    const canFetchGuestUser =
        LEGACY_SHARING_ENABLED &&
        isGuest && guestMode.type === 'user' && !!guestMode.userId;
    const canFetchActivities =
        isInitialized &&
        (canFetchAuthenticatedData || canFetchGuestActivities || canFetchGuestUser);
    const cacheScope = useMemo(
        () =>
            buildCacheScope({
                isGuest,
                userId,
                guestType: guestMode.type,
                guestUserId: guestMode.userId ?? undefined,
                guestActivityIds,
            }),
        [isGuest, userId, guestMode.type, guestMode.userId, guestActivityIds],
    );
    const queryKey = useMemo(
        () =>
            buildActivitiesQueryKey({
                isGuest,
                userId: userId ?? null,
                guestType: guestMode.type,
                guestUserId: guestMode.userId ?? null,
                guestActivityIds,
            }),
        [isGuest, userId, guestMode.type, guestMode.userId, guestActivityIds],
    );
    const query = useInfiniteQuery({
        queryKey,
        // React Query deduplicates this fetch across all consumers. Persist
        // only its page, once, before ActivityStreamer requests the next one.
        queryFn: ({ pageParam }) => fetchAndPersistPage({
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

                return getUserActivities({ offset: pageParam, limit: 500 });
            },
            persistPage: (page) => cacheScope
                ? upsertCachedActivities(cacheScope, page)
                : Promise.resolve(),
            onPersistenceError: (error) => {
                console.error('Failed to persist activities in IndexedDB cache:', error);
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
            return getCachedActivities(cacheScope);
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
                .filter((act) => (act.map_polyline ?? act.map_summary_polyline))
                .map(createFeature),
        };
    }, [activities]);
}
