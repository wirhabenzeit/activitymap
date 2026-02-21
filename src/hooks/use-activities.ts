"use client";

import { useInfiniteQuery } from '@tanstack/react-query';
import { getUserActivities } from '~/server/db/actions';
import { createFeature } from '~/lib/activity-utils';
import { useMemo } from 'react';
import type { FeatureCollection } from 'geojson';
import { useShallowStore } from '~/store';

export function useActivities() {
    const { userId, isInitialized, isGuest } = useShallowStore((state) => ({
        userId: state.user?.id,
        isInitialized: state.isInitialized,
        isGuest: state.isGuest,
    }));
    const canFetchUserData = isInitialized && !!userId && !isGuest;

    const query = useInfiniteQuery({
        queryKey: ['activities', userId ?? null],
        queryFn: ({ pageParam }) => getUserActivities({ offset: pageParam, limit: 500 }),
        enabled: canFetchUserData,
        initialPageParam: 0,
        getNextPageParam: (lastPage, allPages) => {
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

    const { hasNextPage, fetchNextPage, isFetching } = query;

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
                .filter((act) => act.map_polyline || act.map_summary_polyline)
                .map(createFeature),
        };
    }, [activities]);
}
