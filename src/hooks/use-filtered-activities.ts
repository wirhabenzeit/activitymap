"use client";

import { useActivities } from './use-activities';
import { useShallowStore } from '~/store';
import { applyFilters } from '~/store/filter';
import { useMemo } from 'react';
import type { Activity } from '~/server/db/schema';

export function useFilteredActivities(
    activitiesOverride?: Activity[],
) {
    const { data: activitiesFromHook } = useActivities();
    const activities = activitiesOverride ?? activitiesFromHook;

    // We selector the entire filter state parts required for filtering
    const filterState = useShallowStore((state) => ({
        sportType: state.sportType,
        sportGroup: state.sportGroup,
        dateRange: state.dateRange,
        values: state.values,
        search: state.search,
        binary: state.binary,
    }));

    const filteredActivities = useMemo(() => {
        if (!activities) return [];
        return activities.filter((act) => applyFilters(filterState, act));
    }, [activities, filterState]);

    const filterIDs = useMemo(() => {
        return filteredActivities.map((a) => a.id);
    }, [filteredActivities]);

    return { filteredActivities, filterIDs };
}
