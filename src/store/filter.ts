import { type StateCreator } from 'zustand';
import { type Dispatch, type SetStateAction } from 'react';
import { type SportType, type Activity } from '~/server/db/schema';
import {
  aliasMap,
  categorySettings,
  type CategorySetting,
} from '~/settings/category';
import { inequalityFilters, binaryFilters } from '~/settings/filter';
import { type RootState } from './index';

type CategoryGroup = keyof CategorySetting;
type ValueColumn = keyof typeof inequalityFilters;

export type BinaryColumn = keyof Pick<
  Activity,
  'commute' | 'private' | 'flagged'
>;

export type DateRange = {
  start: Date;
  end: Date;
};

export type ValueFilter = {
  value: number;
  operator: '>=' | '<=';
};

export type FilterState = {
  sportType: Record<SportType, boolean>;
  sportGroup: Record<CategoryGroup, boolean>;
  dateRange: { start: Date; end: Date } | undefined;
  values: Record<ValueColumn, ValueFilter | undefined>;
  search: string;
  binary: Record<keyof Activity, boolean | undefined>;
  filterIDs: number[];
};

type FilterActions = {
  setSportGroup: Dispatch<SetStateAction<Record<CategoryGroup, boolean>>>;
  setSportType: Dispatch<SetStateAction<Record<SportType, boolean>>>;
  setDateRange: Dispatch<
    SetStateAction<{ start: Date; end: Date } | undefined>
  >;
  setValues: Dispatch<
    SetStateAction<Record<ValueColumn, ValueFilter | undefined>>
  >;
  setSearch: Dispatch<SetStateAction<string>>;
  setBinary: Dispatch<
    SetStateAction<Record<keyof Activity, boolean | undefined>>
  >;
  updateFilters: () => void;
};

export type FilterSlice = FilterState & FilterActions;

const initializeSportType = () =>
  Object.fromEntries(
    Object.values(categorySettings).flatMap(({ alias }) =>
      alias.map((a) => [a, true]),
    ),
  ) as Record<SportType, boolean>;

const initializeSportGroup = () =>
  Object.fromEntries(
    Object.keys(categorySettings).map((key) => [key, true]),
  ) as Record<CategoryGroup, boolean>;

export const createFilterSlice: StateCreator<
  RootState,
  [['zustand/immer', never]],
  [],
  FilterSlice
> = (set, get) => ({
  // Initial state
  sportType: initializeSportType(),
  sportGroup: initializeSportGroup(),
  dateRange: undefined,
  values: {
    distance: undefined,
    moving_time: undefined,
    elapsed_time: undefined,
    total_elevation_gain: undefined,
    elev_high: undefined,
    elev_low: undefined,
  },
  search: '',
  binary: {} as Record<keyof Activity, boolean | undefined>,
  filterIDs: [],

  // Actions
  setSportGroup: (update) => {
    set((state) => {
      const newSportGroup =
        typeof update === 'function' ? update(state.sportGroup) : update;

      state.sportGroup = newSportGroup;

      // Update sport types based on group changes
      const selectedGroups = Object.entries(newSportGroup)
        .filter(([_, value]) => value)
        .map(([key]) => key as CategoryGroup);

      state.sportType = Object.fromEntries(
        Object.entries(state.sportType).map(([key, _]) => [
          key,
          selectedGroups.some((group) =>
            categorySettings[group].alias.includes(key as SportType),
          ),
        ]),
      ) as Record<SportType, boolean>;
    });
  },

  setSportType: (update) => {
    set((state) => {
      state.sportType =
        typeof update === 'function' ? update(state.sportType) : update;
    });
  },

  setDateRange: (update) => {
    set((state) => {
      state.dateRange =
        typeof update === 'function' ? update(state.dateRange) : update;
    });
  },

  setValues: (update) => {
    set((state) => {
      state.values =
        typeof update === 'function' ? update(state.values) : update;
    });
  },

  setSearch: (update) => {
    set((state) => {
      state.search =
        typeof update === 'function' ? update(state.search) : update;
    });
  },

  setBinary: (update) => {
    set((state) => {
      state.binary =
        typeof update === 'function' ? update(state.binary) : update;
    });
  },

  updateFilters: () => {
    set((state) => {
      const activities = Object.values(get().activityDict);
      state.filterIDs = activities
        .filter((activity) => {
          // Sport type filter
          if (!state.sportType[activity.sport_type]) return false;

          // Date range filter
          if (state.dateRange) {
            const activityDate = new Date(activity.start_date_local);
            if (
              activityDate < state.dateRange.start ||
              activityDate > state.dateRange.end
            ) {
              return false;
            }
          }

          // Value filters
          for (const [key, filter] of Object.entries(state.values)) {
            if (!filter) continue;
            const value = activity[key as keyof Activity] as number;
            if (filter.operator === '>=' && value < filter.value) return false;
            if (filter.operator === '<=' && value > filter.value) return false;
          }

          // Binary filters
          for (const [key, value] of Object.entries(state.binary)) {
            if (value === undefined) continue;
            if (activity[key as keyof Activity] !== value) return false;
          }

          // Search filter
          if (
            state.search &&
            !activity.name.toLowerCase().includes(state.search.toLowerCase())
          ) {
            return false;
          }

          return true;
        })
        .map((activity) => activity.id);
    });
  },
});
