/** Shared web list/detail semantics; all numbers here remain canonical. */
export type Reducer = 'sum' | 'mean' | 'min' | 'max';
export function aggregateMetric(
  values: (number | null | undefined)[],
  reducer: Reducer,
) {
  const known = values.filter((v): v is number => !isMissing(v));
  const count = known.length;
  const value =
    count === 0
      ? values.length === 0 && reducer === 'sum'
        ? 0
        : null
      : reducer === 'sum' || reducer === 'mean'
        ? known.reduce((sum, v) => sum + v, 0) /
          (reducer === 'mean' ? count : 1)
        : known.reduce((a, b) =>
            reducer === 'min' ? Math.min(a, b) : Math.max(a, b),
          );
  return { value, known: count, total: values.length };
}

const geometryOrder = ['summary', 'detailed', 'refresh_required'];
type Sortable = { id: number };
type Sorting = { id: string; desc: boolean }[];
type SortKey = number | string | null;
const defaultSorting: Sorting = [{ id: 'id', desc: true }];

/** Unknown values: absent or non-finite numbers. Zero is a recorded value. */
export const isMissing = (value: unknown) =>
  value == null || (typeof value === 'number' && !Number.isFinite(value));

function sortValue(activity: Sortable, key: string): unknown {
  const row = activity as unknown as Record<string, unknown>;
  if (key === 'date') return row.start_date_local;
  if (key === 'photos') return row.total_photo_count;
  if (key === 'geometry_state')
    return typeof row.geometryState === 'string'
      ? geometryOrder.indexOf(row.geometryState)
      : null;
  return row[key];
}
function sortKey(activity: Sortable, key: string): SortKey {
  const value = sortValue(activity, key);
  if (isMissing(value)) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return value.normalize('NFC').toLowerCase();
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function compareKeys(
  a: { id: number; keys: SortKey[] },
  b: { id: number; keys: SortKey[] },
  sorting: Sorting,
): number {
  for (let i = 0; i < sorting.length; i++) {
    const x = a.keys[i]!,
      y = b.keys[i]!;
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
      continue;
    }
    const result =
      typeof x === 'string' && typeof y === 'string'
        ? compareText(x, y)
        : x < y
          ? -1
          : x > y
            ? 1
            : 0;
    if (result) return sorting[i]!.desc ? -result : result;
  }
  return b.id - a.id;
}
const keyed = (activity: Sortable, sorting: Sorting) => ({
  id: activity.id,
  keys: sorting.map(({ id }) => sortKey(activity, id)),
});

export function compareActivities(
  a: Sortable,
  b: Sortable,
  sorting: Sorting,
): number {
  const order = sorting.length ? sorting : defaultSorting;
  return compareKeys(keyed(a, order), keyed(b, order), order);
}

/** Sorts a copy, computing each activity's sort keys once. */
export function sortActivities<T extends Sortable>(
  activities: readonly T[],
  sorting: Sorting,
): T[] {
  const order = sorting.length ? sorting : defaultSorting;
  return activities
    .map((activity) => ({ activity, ...keyed(activity, order) }))
    .sort((a, b) => compareKeys(a, b, order))
    .map(({ activity }) => activity);
}

/** Unicode scalar order, independent of UTF-16 surrogate layout. */
function compareText(a: string, b: string): number {
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!,
      y = b.codePointAt(j)!;
    if (x !== y) return x - y;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return a.length - i - (b.length - j);
}
