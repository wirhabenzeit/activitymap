import { type StateCreator } from 'zustand';
import * as d3 from 'd3';

import { aliasMap, categorySettings } from '~/settings/category';

import { type CategorySetting } from '~/settings/category';
import { inequalityFilters, binaryFilters } from '~/settings/filter';
import {
  type BooleanColumn,
  type SportType,
  type Activity,
  type ValueColumn,
} from '~/server/db/schema';

import { type TotalZustand } from './Zustand';

type CategoryGroup = keyof CategorySetting;

export type FilterZustand = {
  sportType: Record<SportType, boolean>;
  sportGroup: Record<CategoryGroup, boolean>;
  dateRange: { start: Date; end: Date } | undefined;
  values: Record<ValueColumn, [number, number] | undefined>;
  search: string;
  binary: Record<keyof Activity, boolean | undefined>;
  filterRanges: Record<ValueColumn, [number, number] | undefined>;
  filterRangesSet: boolean;
  filterIDs: number[];
  toggleSportGroup: (group: CategoryGroup) => void;
  toggleSportType: (type: SportType) => void;
  setDateRange: (range: { start: Date; end: Date }) => void;
  setValueFilter: (
    id: ValueColumn,
    value: [number, number] | undefined,
  ) => void;
  setSearch: (search: string) => void;
  setBinary: (id: BooleanColumn, value: boolean | undefined) => void;
  updateFilters: () => void;
  setFilterRanges: () => void;
};

export const filterSlice: StateCreator<
  TotalZustand,
  [['zustand/immer', never]],
  [],
  FilterZustand
> = (set) => ({
  sportType: Object.fromEntries(
    Object.values(categorySettings).flatMap(
      ({ alias }: { alias: SportType[] }) =>
        alias.map((a: SportType) => [a, true]),
    ),
  ) as Record<SportType, boolean>,
  sportGroup: Object.fromEntries(
    Object.keys(categorySettings).map((key) => [key as CategoryGroup, true]),
  ) as Record<CategoryGroup, boolean>,
  toggleSportGroup: (group) => {
    set((state) => {
      state.sportGroup[group] = !state.sportGroup[group];
      categorySettings[group].alias.forEach((key) => {
        state.sportType[key] = state.sportGroup[group];
      });
    });
  },
  toggleSportType: (type) => {
    set((state) => {
      state.sportType[type] = !state.sportType[type];
      const group = aliasMap[type]!;
      if (!state.sportGroup[group] && state.sportType[type]) {
        state.sportGroup[group] = true;
      }
      if (
        state.sportGroup[group] &&
        categorySettings[group].alias.every((key) => !state.sportType[key])
      ) {
        state.sportGroup[group] = false;
      }
    });
  },
  dateRange: undefined,
  values: Object.fromEntries(
    Object.keys(inequalityFilters).map((key) => [key, undefined]),
  ) as Record<ValueColumn, [number, number] | undefined>,
  search: '',
  binary: Object.fromEntries(
    Object.entries(binaryFilters).map(([key, { defaultValue }]) => [
      key,
      defaultValue,
    ]),
  ) as Record<keyof Activity, boolean | undefined>,
  filterRanges: Object.fromEntries(
    Object.keys(inequalityFilters).map((key) => [key, undefined]),
  ) as Record<ValueColumn, [number, number] | undefined>,
  filterRangesSet: false,
  filterIDs: [],
  setDateRange: (range: { start: Date; end: Date }) => {
    set((state) => {
      state.dateRange = range;
    });
  },
  setBinary: (id, value) =>
    set((state) => {
      state.binary[id] = value;
    }),
  setValueFilter: (id, value) =>
    set((state) => {
      state.values[id] = value;
    }),
  setSearch: (search) =>
    set((state) => {
      state.search = search;
    }),
  updateFilters: () =>
    set((state) => {
      const filter = (row: Activity) => {
        const activeCat = Object.entries(state.sportType)
          .filter(([key, active]) => active)
          .map(([key, active]) => key) as SportType[];
        if (!activeCat.includes(row.sport_type)) {
          return false;
        }
        if (state.dateRange) {
          const startDate = state.dateRange.start.getTime() / 1000;
          const endDate = new Date(state.dateRange.end);
          endDate.setMonth(endDate.getMonth() + 1);
          endDate.setDate(0); // Set to the last day of the previous month
          endDate.setHours(23, 59, 59, 999); // Set to the last moment of the day
          const endDateTimestamp = endDate.getTime() / 1000;

          if (
            row.start_date_local_timestamp < startDate ||
            row.start_date_local_timestamp > endDateTimestamp
          ) {
            return false;
          }
        }
        if (
          state.search &&
          !row.name.toLowerCase().includes(state.search.toLowerCase()) &&
          !row.description?.toLowerCase().includes(state.search.toLowerCase())
        ) {
          return false;
        }
        if (
          Object.entries(state.values).some(([key, value]) => {
            const columnValue = row[key as ValueColumn];
            return (
              value !== undefined &&
              columnValue !== null &&
              (columnValue < value[0] || columnValue > value[1])
            );
          })
        )
          return false;
        if (
          Object.entries(state.binary).some(
            ([key, value]) =>
              value !== undefined && row[key as BooleanColumn] != value,
          )
        ) {
          return false;
        }
        return true;
      };
      state.filterIDs = Object.values(state.activityDict)
        .filter(filter)
        .map((act) => Number(act.id));
    }),
  setFilterRanges: () =>
    set((state) => {
      const filterRanges = Object.fromEntries(
        Object.entries(inequalityFilters).map(([key]) => {
          const values = Object.values(state.activityDict)
            .map((feature) => feature[key as ValueColumn])
            .filter((v): v is number => v != null);
          return [
            key as ValueColumn,
            d3.extent(values).map(Number) as [number, number],
          ];
        }),
      ) as Record<ValueColumn, [number, number]>;
      state.filterRanges = filterRanges;
      state.filterRangesSet = true;
      state.values = filterRanges;
    }),
});
