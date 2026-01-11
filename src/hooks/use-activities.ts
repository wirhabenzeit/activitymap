"use client";

import { useQuery } from '@tanstack/react-query';
import { getUserActivities } from '~/server/db/actions';
import { createFeature } from '~/lib/activity-utils';
import { useMemo } from 'react';
import type { FeatureCollection } from 'geojson';

export function useActivities() {
    return useQuery({
        queryKey: ['activities'],
        queryFn: () => getUserActivities(),
        // Data is valid forever until explicitly invalidated (local-first)
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
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
