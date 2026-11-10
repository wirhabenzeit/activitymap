import { isPersonalDataKey } from '~/server/logging/redact';

/**
 * Field-by-field comparison of what the app serves from Postgres and from the
 * Convex application backend. Shared by `pnpm convex:verify-owner` (whole
 * library, local database) and the scheduled production parity check.
 */

/** Opaque per-backend tokens: Postgres uses result UUIDs, Convex the change
 * sequence. Clients only compare them within one backend, and moving an owner
 * between backends forces a new bootstrap. */
export const EXPECTED_DIFFERENCES = new Set([
  'activity.placeMatches.resultRevision',
]);

export type Difference = { count: number; example: string };

const EXAMPLE_CHARS = 160;

/** Besides the logger's personal-data keys: recorded coordinates, and photo
 * text, locations and image URLs. None of these may reach a report or log. */
const PRIVATE_KEYS = new Set([
  'latlng',
  'caption',
  'activity_name',
  'location',
  'urls',
]);
const isPrivateKey = (key: string) =>
  isPersonalDataKey(key) || PRIVATE_KEYS.has(key.toLowerCase());
const size = (value: unknown) => `<${JSON.stringify(value).length} chars>`;

/** `value` with everything under a private key replaced by its length, at
 * any depth, so a parent object can be shown without its private parts. */
function withoutPrivateValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPrivateValues);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      item === null || item === undefined
        ? item
        : isPrivateKey(key)
          ? size(item)
          : withoutPrivateValues(item),
    ]),
  );
}

function preview(field: string, value: unknown) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  // The field itself, or anything it is nested in, is private.
  if (field.split('.').some(isPrivateKey)) return size(value);
  return JSON.stringify(withoutPrivateValues(value)).slice(0, EXAMPLE_CHARS);
}

export function createComparison(expected = EXPECTED_DIFFERENCES) {
  const differences = new Map<string, Difference>();
  const expectedCounts = new Map<string, number>();

  function note(field: string, id: string, left: unknown, right: unknown) {
    if (expected.has(field)) {
      expectedCounts.set(field, (expectedCounts.get(field) ?? 0) + 1);
      return;
    }
    const entry = differences.get(field) ?? {
      count: 0,
      example: `${id}: ${preview(field, left)} != ${preview(field, right)}`,
    };
    entry.count++;
    differences.set(field, entry);
  }

  /** Records each differing leaf under its dotted path. Values compare as the
   * JSON a handler would send, so absent and `undefined` fields are equal. */
  function compare(prefix: string, id: string, left: unknown, right: unknown) {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    if (
      left &&
      right &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys)
        compare(
          `${prefix}.${key}`,
          id,
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        );
      return;
    }
    note(prefix, id, left, right);
  }

  /** Compare two keyed collections: missing, extra and differing items. */
  function compareItems<T>(
    prefix: string,
    left: T[],
    right: T[],
    key: (item: T) => string,
  ) {
    const rightByKey = new Map(right.map((item) => [key(item), item]));
    const leftKeys = new Set<string>();
    for (const item of left) {
      const id = key(item);
      leftKeys.add(id);
      const other = rightByKey.get(id);
      if (other === undefined)
        note(`<${prefix} missing in convex>`, id, id, null);
      else compare(prefix, id, item, other);
    }
    for (const id of rightByKey.keys())
      if (!leftKeys.has(id)) note(`<${prefix} extra in convex>`, id, null, id);
  }

  return {
    note,
    compare,
    compareItems,
    /** Differences sorted by count, most frequent first. */
    differences: () =>
      Object.fromEntries(
        [...differences].sort((a, b) => b[1].count - a[1].count),
      ),
    expected: () => Object.fromEntries(expectedCounts),
  };
}
