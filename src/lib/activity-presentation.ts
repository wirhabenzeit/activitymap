/** Shared web list/detail semantics; all numbers here remain canonical. */
export type Reducer = 'sum' | 'mean' | 'min' | 'max';
export function aggregateMetric(
  values: (number | null | undefined)[],
  reducer: Reducer,
) {
  const known = values.filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
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
const missing = (value: unknown) =>
  value == null || (typeof value === 'number' && !Number.isFinite(value));
export function compareActivities(
  a: Sortable,
  b: Sortable,
  sorting: { id: string; desc: boolean }[],
): number {
  for (const { id, desc } of sorting.length
    ? sorting
    : [{ id: 'id', desc: true }]) {
    const av = sortValue(a, id),
      bv = sortValue(b, id);
    if (missing(av) || missing(bv)) {
      if (missing(av) !== missing(bv)) return missing(av) ? 1 : -1;
      continue;
    }
    const x =
      av instanceof Date
        ? av.getTime()
        : typeof av === 'string'
          ? av.normalize('NFC').toLowerCase()
          : Number(av);
    const y =
      bv instanceof Date
        ? bv.getTime()
        : typeof bv === 'string'
          ? bv.normalize('NFC').toLowerCase()
          : Number(bv);
    const result =
      typeof x === 'string' && typeof y === 'string'
        ? compareText(x, y)
        : x < y
          ? -1
          : x > y
            ? 1
            : 0;
    if (result) return desc ? -result : result;
  }
  return b.id - a.id;
}

function compareText(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0)!);
  const y = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i]! - y[i]!;
  }
  return x.length - y.length;
}
