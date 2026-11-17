import type { SetStateAction } from 'react';
import type { StateCreator } from 'zustand';

import type { SportType } from '~/contracts/sport';
import { aliasMap, categorySettings } from '~/settings/category';

import type { CategoryGroup } from './filter';
import type { RootState } from './index';

export type StatsSports = Record<CategoryGroup, boolean>;
export const allStatsSports = (): StatsSports =>
  Object.fromEntries(
    Object.keys(categorySettings).map((group) => [group, true]),
  ) as StatsSports;

export function initialStatsSports(
  sports: Record<SportType, boolean>,
): StatsSports {
  const groups = Object.fromEntries(
    Object.entries(categorySettings).map(([group, { alias }]) => [
      group,
      alias.some((sport) => sports[sport]),
    ]),
  ) as StatsSports;
  return Object.values(groups).some(Boolean) ? groups : allStatsSports();
}

export function sanitizeStatsSports(
  value: unknown,
  fallback: StatsSports,
): StatsSports {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ...fallback };
  const result = { ...fallback };
  for (const group of Object.keys(result) as CategoryGroup[]) {
    const candidate = (value as Record<string, unknown>)[group];
    if (typeof candidate === 'boolean') result[group] = candidate;
  }
  return result;
}

export function filterByStatsSports<T extends { sport_type: SportType }>(
  activities: readonly T[],
  sports: StatsSports,
): T[] {
  return activities.filter(
    (activity) => sports[aliasMap[activity.sport_type] ?? 'misc'],
  );
}

export type StatsScopeSlice = {
  statsSports: StatsSports;
  setStatsSports: (update: SetStateAction<StatsSports>) => void;
  resetStatsScope: () => void;
};

export const createStatsScopeSlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  StatsScopeSlice
> = (set) => ({
  statsSports: allStatsSports(),
  setStatsSports: (update) =>
    set((state) => {
      state.statsSports =
        typeof update === 'function' ? update(state.statsSports) : update;
    }),
  resetStatsScope: () =>
    set((state) => {
      state.statsSports = allStatsSports();
    }),
});
