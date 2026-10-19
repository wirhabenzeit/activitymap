import type { Activity } from '~/lib/activity';
import { type FilterState, applyFilters } from '~/store/filter';

/** Ordinary eligibility only. Selection never feeds this projection. */
export function projectActivities(
  activities: Activity[] | undefined,
  filters: FilterState,
) {
  const filteredActivities: Activity[] = [];
  const filterIDs: number[] = [];
  for (const activity of activities ?? []) {
    if (applyFilters(filters, activity)) {
      filteredActivities.push(activity);
      filterIDs.push(activity.id);
    }
  }
  return { filteredActivities, filterIDs, filterIDSet: new Set(filterIDs) };
}

/** Undefined/partial data cannot prove that a selected identity was deleted. */
export function committedSelectionIDs(
  activities: Activity[] | undefined,
  complete: boolean,
) {
  return activities !== undefined && complete
    ? activities.map(({ id }) => id)
    : null;
}
