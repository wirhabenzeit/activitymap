"use client";

import { useActivities } from './use-activities';
import { useShallowStore } from '~/store';
import { applyFilters, type FilterState } from '~/store/filter';
import { useMemo } from 'react';

export function useFilteredActivities() {
    const { data: activities } = useActivities();

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
        // Cast filterState to FilterState type as it matches the shape required by applyFilters
        return activities.filter((act) => applyFilters(filterState as FilterState, act));
    }, [activities, filterState]);

    const filterIDs = useMemo(() => {
        return filteredActivities.map((a) => a.id);
    }, [filteredActivities]);

    return { filteredActivities, filterIDs };
}
