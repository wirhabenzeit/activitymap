import { v } from 'convex/values';

/** The counts kept per owner by convex/stats.ts (the status view's shape). */
export const COUNT_FIELDS = [
  'total',
  'detailed',
  'neverFetched',
  'invalidatedDetails',
  'activitiesWithPhotos',
  'activitiesWithStoredPhotos',
  'currentPhotos',
  'refreshRequiredPhotos',
  'unknownPhotos',
  'photoCount',
  'withData',
  'withoutData',
  'runnable',
  'waiting',
  'blocked',
  'invalidatedStreams',
  'chartSummaries',
] as const;
export type Counts = Record<(typeof COUNT_FIELDS)[number], number>;
export const countsValidator = v.object(
  Object.fromEntries(COUNT_FIELDS.map((field) => [field, v.number()])) as {
    [K in (typeof COUNT_FIELDS)[number]]: ReturnType<typeof v.number>;
  },
);

export function zeroCounts(): Counts {
  return Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0])) as Counts;
}
