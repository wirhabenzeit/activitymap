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
import {
    getCachedActivities,
    upsertCachedActivities,
} from '~/lib/offline/db';

const memoryActivitiesByScope = new Map<string, Activity[]>();

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
    const canFetchGuestActivities =
        isGuest && guestMode.type === 'activities' && guestActivityIds.length > 0;
    const canFetchGuestUser =
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
    const initialData = useMemo(() => {
        if (!cacheScope) return undefined;
        const seed = memoryActivitiesByScope.get(cacheScope);
        if (!seed || seed.length === 0) return undefined;
        return {
            pages: [seed],
            pageParams: [0],
        } satisfies InfiniteData<Activity[], number>;
    }, [cacheScope]);

    const query = useInfiniteQuery({
        queryKey,
        queryFn: ({ pageParam }) => {
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
        enabled: canFetchActivities,
        initialPageParam: 0,
        getNextPageParam: (lastPage, allPages) => {
            if (canFetchGuestActivities) {
                return undefined;
            }

            if (lastPage.length < 500) return undefined;
            return allPages.length * 500;
        },
        select: (data) => data.pages.flat(),
        // Data is valid forever until explicitly invalidated (local-first)
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        initialData,

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

        memoryActivitiesByScope.set(cacheScope, cacheQuery.data);

        queryClient.setQueryData<InfiniteData<Activity[], number>>(
            queryKey,
            (current) =>
                current ?? {
                    pages: [cacheQuery.data],
                    pageParams: [0],
                },
        );
    }, [cacheQuery.data, cacheScope, queryClient, queryKey]);

    useEffect(() => {
        if (!cacheScope || !query.data || query.data.length === 0) {
            return;
        }

        memoryActivitiesByScope.set(cacheScope, query.data);

        void upsertCachedActivities(cacheScope, query.data).catch((error: unknown) => {
            console.error('Failed to persist activities in IndexedDB cache:', error);
        });
    }, [cacheScope, query.data]);

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
