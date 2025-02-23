import { type StateCreator } from 'zustand';
import { type Dispatch, type SetStateAction } from 'react';
import { type SportType, type Activity } from '~/server/db/schema';
import { categorySettings, type CategorySetting } from '~/settings/category';
import { type inequalityFilters, binaryFilters } from '~/settings/filter';
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
  dateRange: DateRange | undefined;
  values: Record<ValueColumn, ValueFilter | undefined>;
  search: string;
  binary: Record<BinaryColumn, boolean>;
  filterIDs: number[];
  activityDict: Record<number, Activity>;
};

export type FilterActions = {
  setSportGroup: (
    update: SetStateAction<Record<CategoryGroup, boolean>>,
  ) => void;
  setSportType: (update: SetStateAction<Record<SportType, boolean>>) => void;
  setDateRange: (update: SetStateAction<DateRange | undefined>) => void;
  setValues: (
    update: SetStateAction<Record<ValueColumn, ValueFilter | undefined>>,
  ) => void;
  setSearch: (update: SetStateAction<string>) => void;
  setBinary: (update: SetStateAction<Record<BinaryColumn, boolean>>) => void;
  updateFilterIDs: () => void;
};

export type FilterSlice = FilterState & FilterActions;

const initializeSportType = (): Record<SportType, boolean> =>
  Object.fromEntries(
    Object.values(categorySettings).flatMap(({ alias }) =>
      alias.map((a) => [a, true]),
    ),
  ) as Record<SportType, boolean>;

const initializeSportGroup = (): Record<CategoryGroup, boolean> =>
  Object.fromEntries(
    Object.keys(categorySettings).map((key) => [key, true]),
  ) as Record<CategoryGroup, boolean>;

const initializeValues = (): Record<ValueColumn, ValueFilter | undefined> => ({
  distance: undefined,
  elapsed_time: undefined,
  total_elevation_gain: undefined,
});

const initializeBinary = (): Record<BinaryColumn, boolean> => ({
  commute: false,
  private: false,
  flagged: false,
});

const applyFilters = (state: FilterState, activity: Activity): boolean => {
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
};

export const createFilterSlice: StateCreator<
  RootState,
  [['zustand/immer', never]],
  [],
  FilterSlice
> = (set, get, store) => {
  const updateFilterIDs = () => {
    set((state) => {
      const activities = Object.values(get().activityDict);
      state.filterIDs = activities
        .filter((activity) => applyFilters(state, activity))
        .map((activity) => activity.public_id);
    });
  };

  const slices: FilterSlice = {
    // Initial state
    sportType: initializeSportType(),
    sportGroup: initializeSportGroup(),
    dateRange: undefined,
    values: initializeValues(),
    search: '',
    binary: initializeBinary(),
    filterIDs: [],
    activityDict: {},

    // Actions
    updateFilterIDs,
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
  };

  store.subscribe((state, prevState) => {
    if (
      state.sportType !== prevState.sportType ||
      state.binary !== prevState.binary ||
      state.search !== prevState.search ||
      state.values !== prevState.values ||
      state.dateRange !== prevState.dateRange ||
      state.activityDict !== prevState.activityDict
    ) {
      updateFilterIDs();
    }
  });

  return slices;
};
