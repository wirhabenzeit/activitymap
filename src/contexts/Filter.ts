import {type StateCreator} from "zustand";
import * as d3 from "d3";

import {categorySettings} from "~/settings/category";

import {type CategorySetting} from "~/settings/category";
import {
  filterSettings,
  binaryFilters,
} from "~/settings/filter";
import {
  type BooleanColumn,
  type SportType,
  type Activity,
  type ValueColumn,
} from "~/server/db/schema";

import {type TotalZustand} from "./Zustand";

type CategoryGroup = keyof CategorySetting;

export type FilterZustand = {
  categories: Record<
    CategoryGroup,
    {active: boolean; filter: string[]}
  >;
  values: Record<ValueColumn, [number, number] | undefined>;
  search: string;
  binary: Record<keyof Activity, boolean | undefined>;
  filterRanges: Record<
    ValueColumn,
    [number, number] | undefined
  >;
  filterRangesSet: boolean;
  filterIDs: number[];
  toggleCategory: (group: CategoryGroup) => void;
  updateCategory: (
    group: CategoryGroup,
    category: string[]
  ) => void;
  setValueFilter: (
    id: ValueColumn,
    value: [number, number] | undefined
  ) => void;
  setSearch: (search: string) => void;
  setBinary: (
    id: BooleanColumn,
    value: boolean | undefined
  ) => void;
  updateFilters: () => void;
  setFilterRanges: () => void;
};

export const filterSlice: StateCreator<
  TotalZustand,
  [["zustand/immer", never]],
  [],
  FilterZustand
> = (set) => ({
  categories: Object.fromEntries(
    Object.entries(categorySettings).map(
      ([key, {active, alias}]) => [
        key as CategoryGroup,
        {active, filter: active ? alias : []},
      ]
    )
  ) as Record<
    CategoryGroup,
    {active: boolean; filter: string[]}
  >,
  values: Object.fromEntries(
    Object.keys(filterSettings).map((key) => [
      key,
      undefined,
    ])
  ) as Record<ValueColumn, [number, number] | undefined>,
  search: "",
  binary: Object.fromEntries(
    Object.entries(binaryFilters).map(
      ([key, {defaultValue}]) => [key, defaultValue]
    )
  ) as Record<keyof Activity, boolean | undefined>,
  filterRanges: Object.fromEntries(
    Object.keys(filterSettings).map((key) => [
      key,
      undefined,
    ])
  ) as Record<ValueColumn, [number, number] | undefined>,
  filterRangesSet: false,
  filterIDs: [],
  toggleCategory: (group) =>
    set((state) => {
      state.categories[group].filter = state.categories[
        group
      ].active
        ? []
        : (categorySettings[group].alias as string[]);
      state.categories[group].active =
        !state.categories[group].active;
    }),
  setBinary: (id, value) =>
    set((state) => {
      state.binary[id] = value;
    }),
  updateCategory: (group, category) =>
    set((state) => {
      state.categories[group].filter = category;
      state.categories[group].active = category.length > 0;
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
        const activeCat = [] as SportType[];
        Object.entries(state.categories).forEach(
          ([, value]) => {
            activeCat.push(
              ...(value.filter as SportType[])
            );
          }
        );
        if (!activeCat.includes(row.sport_type)) {
          return false;
        }
        if (
          state.search &&
          !row.name
            .toLowerCase()
            .includes(state.search.toLowerCase())
        ) {
          return false;
        }
        if (
          Object.entries(state.values).some(
            ([key, value]) => {
              const columnValue = row[key as ValueColumn];
              return (
                value !== undefined &&
                columnValue !== null &&
                (columnValue < value[0] ||
                  columnValue > value[1])
              );
            }
          )
        )
          return false;
        if (
          Object.entries(state.binary).some(
            ([key, value]) =>
              value !== undefined &&
              row[key as BooleanColumn] != value
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
        Object.entries(filterSettings).map(([key]) => {
          const values = Object.values(state.activityDict)
            .map((feature) => feature[key as ValueColumn])
            .filter((v): v is number => v != null);
          return [
            key as ValueColumn,
            d3.extent(values).map(Number) as [
              number,
              number
            ],
          ];
        })
      ) as Record<ValueColumn, [number, number]>;
      state.filterRanges = filterRanges;
      state.filterRangesSet = true;
      state.values = filterRanges;
    }),
});
