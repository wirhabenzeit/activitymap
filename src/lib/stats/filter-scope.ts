import { categorySettings } from '~/settings/category';
import {
  applyFilters,
  type FilterState,
  type FilterableActivity,
} from '~/store/filter';

// Preserve comparison history. Every other sidebar constraint applies equally
// to the reporting period and its comparison periods.
export function filterStatsActivities<T extends FilterableActivity>(
  activities: readonly T[],
  state: FilterState,
): T[] {
  const scope = { ...state, dateRange: undefined };
  return activities.filter((activity) => applyFilters(scope, activity));
}

export function statsFilterScope(state: FilterState) {
  const groups = Object.values(categorySettings);
  const selected = groups.filter((group) =>
    group.alias.some((type) => state.sportType[type]),
  );
  const allSports = groups.every((group) =>
    group.alias.every((type) => state.sportType[type]),
  );
  const labels: string[] = allSports
    ? []
    : selected.length === 0
      ? ['No sports selected']
      : selected.map(
          (group) =>
            group.name +
            (group.alias.every((type) => state.sportType[type])
              ? ''
              : ' (some types)'),
        );
  if (state.search.trim()) labels.push(`Search: ${state.search.trim()}`);
  for (const [key, mode] of Object.entries(state.binary)) {
    if (mode !== 'any')
      labels.push(`${key[0]!.toUpperCase()}${key.slice(1)}: ${mode}`);
  }
  const numeric = [
    ['distance', 'Distance', 1000, 'km'],
    ['total_elevation_gain', 'Elevation', 1, 'm'],
    ['elapsed_time', 'Elapsed time', 3600, 'h'],
  ] as const;
  for (const [key, label, divisor, unit] of numeric) {
    const filter = state.values[key];
    if (filter)
      labels.push(
        `${label} ${filter.operator} ${filter.value / divisor} ${unit}`,
      );
  }
  return {
    labels,
    filtered: labels.length > 0,
    singleSport: selected.length === 1,
  };
}
