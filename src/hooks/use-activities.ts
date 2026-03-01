"use client";

import { useInfiniteQuery } from '@tanstack/react-query';
import {
    getPublicActivities,
    getPublicUserActivities,
    getUserActivities,
} from '~/server/db/actions';
import { createFeature } from '~/lib/activity-utils';
import { useMemo } from 'react';
import type { FeatureCollection } from 'geojson';
import { useShallowStore } from '~/store';

export function useActivities() {
    const { userId, isInitialized, isGuest, guestMode } = useShallowStore((state) => ({
        userId: state.user?.id,
        isInitialized: state.isInitialized,
        isGuest: state.isGuest,
        guestMode: state.guestMode,
    }));
    const guestActivityIds = guestMode.activityIds ?? [];
    const canFetchAuthenticatedData = !!userId && !isGuest;
    const canFetchGuestActivities =
        isGuest && guestMode.type === 'activities' && guestActivityIds.length > 0;
    const canFetchGuestUser =
        isGuest && guestMode.type === 'user' && !!guestMode.userId;
    const canFetchActivities =
        isInitialized &&
        (canFetchAuthenticatedData || canFetchGuestActivities || canFetchGuestUser);

    const query = useInfiniteQuery({
        queryKey: [
            'activities',
            isGuest ? 'guest' : 'auth',
            userId ?? null,
            guestMode.type,
            guestMode.userId ?? null,
            guestActivityIds.join(','),
        ],
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

    });

    // Streaming logic moved to <ActivityStreamer /> to avoid duplicate fetches
    // when this hook is used in multiple components.

    return query;
}

export function useActivityGeoJson() {
    const { data: activities } = useActivities();

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
