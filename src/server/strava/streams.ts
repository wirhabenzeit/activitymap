import { z } from 'zod';

export const ACTIVITY_STREAM_TYPES = [
  'time',
  'distance',
  'latlng',
  'altitude',
  'watts',
  'heartrate',
] as const;
export type ActivityStreamType = (typeof ACTIVITY_STREAM_TYPES)[number];

/** Keep identifiers as strings through HTTP and bigint storage, never Number. */
export const streamActivityIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine(
    (id) =>
      /^[1-9]\d*$/.test(id) &&
      id.length <= 19 &&
      BigInt(id) <= 9_223_372_036_854_775_807n,
    'Activity ID exceeds PostgreSQL bigint',
  );

function stream<K extends ActivityStreamType, T extends z.ZodType>(
  type: K,
  sample: T,
) {
  return z
    .object({
      // key_by_type identifies the stream; some responses also include type.
      type: z.literal(type).optional(),
      data: z.array(sample),
      original_size: z.number().int().nonnegative(),
      resolution: z.enum(['low', 'medium', 'high']),
      series_type: z.enum(['time', 'distance']),
    })
    .catchall(z.json())
    .refine(
      (value) => value.original_size >= value.data.length,
      'original_size must cover all returned samples',
    );
}

/**
 * Raw key_by_type response. Preserve missing keys and additional stream
 * metadata. Reject malformed samples rather than silently coercing/truncating.
 * Streams need not have equal lengths or regularly spaced timestamps.
 */
export const rawActivityStreamsSchema = z.strictObject({
  time: stream('time', z.number().int().nonnegative()).optional(),
  distance: stream('distance', z.number().nonnegative()).optional(),
  latlng: stream(
    'latlng',
    z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]),
  ).optional(),
  altitude: stream('altitude', z.number()).optional(),
  watts: stream('watts', z.number().int().nonnegative()).optional(),
  heartrate: stream('heartrate', z.number().int().nonnegative()).optional(),
});
export type RawActivityStreams = z.infer<typeof rawActivityStreamsSchema>;

/** Shape diagnostics only: equal lengths do not prove sample alignment. */
export function describeActivityStreams(streams: RawActivityStreams) {
  const availableTypes = ACTIVITY_STREAM_TYPES.filter(
    (type) => streams[type] !== undefined,
  );
  const returned = availableTypes.map((type) => streams[type]!);
  return {
    availableTypes,
    sampleCounts: Object.fromEntries(
      availableTypes.map((type) => [type, streams[type]!.data.length]),
    ),
    matchingLengths:
      new Set(returned.map((value) => value.data.length)).size <= 1,
    matchingSampling:
      new Set(
        returned.map(
          (value) =>
            `${value.resolution}:${value.series_type}:${value.original_size}`,
        ),
      ).size <= 1,
  };
}

export type StreamFetchFailure = {
  code:
    | 'rate_limited'
    | 'unauthorized'
    | 'not_found'
    | 'invalid_response'
    | 'upstream_error';
  retryable: boolean;
};
