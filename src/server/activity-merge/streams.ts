import { z } from 'zod';

/**
 * Every stream a merged recording can carry. Wider than what ActivityMap
 * stores for display (`~/server/strava/streams.ts`): a merge rebuilds the
 * whole recording, so cadence, temperature and the rest come along too.
 * These are fetched for one merge and never persisted.
 */
export const MERGE_STREAM_TYPES = [
  'time',
  'distance',
  'latlng',
  'altitude',
  'heartrate',
  'cadence',
  'watts',
  'temp',
  'moving',
] as const;

const series = <T extends z.ZodType>(sample: T) =>
  z
    .object({ data: z.array(sample.nullable()) })
    .catchall(z.unknown())
    .optional();

export const mergeStreamsSchema = z
  .object({
    time: z.object({ data: z.array(z.number()) }).catchall(z.unknown()),
    distance: series(z.number()),
    latlng: series(z.tuple([z.number(), z.number()])),
    altitude: series(z.number()),
    heartrate: series(z.number()),
    cadence: series(z.number()),
    watts: series(z.number()),
    temp: series(z.number()),
    moving: series(z.boolean()),
  })
  .catchall(z.unknown());

export type MergeStreams = z.infer<typeof mergeStreamsSchema>;
