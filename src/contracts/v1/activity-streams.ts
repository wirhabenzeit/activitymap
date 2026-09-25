import { z } from 'zod';
import {
  ACTIVITY_STREAM_TYPES,
  rawActivityStreamsSchema,
} from '~/server/strava/streams';
import type { StreamSnapshot } from '~/server/repositories/activity-streams';
import { idString, isoDateTime } from './primitives';

export const streamTypeSchema = z.enum(ACTIVITY_STREAM_TYPES);
export const streamFreshnessSchema = z.enum([
  'not_fetched',
  'current',
  'stale',
]);
export const streamFetchStatusSchema = z.enum([
  'not_fetched',
  'pending',
  'succeeded',
  'failed',
  'invalidated',
]);
export const streamFailureCodeSchema = z.enum([
  'rate_limited',
  'unauthorized',
  'not_found',
  'invalid_response',
  'upstream_error',
]);
export const streamMetadataSchema = z.object({
  generation: z.string().nullable(),
  revision: z.string().regex(/^\d+$/),
  state: streamFreshnessSchema,
  fetch_status: streamFetchStatusSchema,
  available_types: z.array(streamTypeSchema),
  fetched_at: isoDateTime.nullable(),
  expires_at: isoDateTime.nullable(),
});
export type StreamMetadata = z.infer<typeof streamMetadataSchema>;

// JSONB was already validated against the stricter raw schema on ingestion.
// Keep extra JSON metadata on the wire without a recursive OpenAPI JSON union.
export const timeStreamSchema = rawActivityStreamsSchema.shape.time
  .unwrap()
  .catchall(z.unknown());
export const distanceStreamSchema = rawActivityStreamsSchema.shape.distance
  .unwrap()
  .catchall(z.unknown());
export const latlngStreamSchema = rawActivityStreamsSchema.shape.latlng
  .unwrap()
  .catchall(z.unknown());
export const altitudeStreamSchema = rawActivityStreamsSchema.shape.altitude
  .unwrap()
  .catchall(z.unknown());
export const wattsStreamSchema = rawActivityStreamsSchema.shape.watts
  .unwrap()
  .catchall(z.unknown());
export const heartrateStreamSchema = rawActivityStreamsSchema.shape.heartrate
  .unwrap()
  .catchall(z.unknown());
export const rawStreamsDTOSchema = z.object({
  time: timeStreamSchema.optional(),
  distance: distanceStreamSchema.optional(),
  latlng: latlngStreamSchema.optional(),
  altitude: altitudeStreamSchema.optional(),
  watts: wattsStreamSchema.optional(),
  heartrate: heartrateStreamSchema.optional(),
});
export const activityStreamsDTOSchema = z.object({
  activity_id: idString,
  metadata: streamMetadataSchema,
  requested_types: z.array(streamTypeSchema),
  streams: rawStreamsDTOSchema.nullable(),
  last_error: z
    .object({ code: streamFailureCodeSchema, retryable: z.boolean() })
    .nullable(),
  next_retry_at: isoDateTime.nullable(),
});
export type ActivityStreamsDTO = z.infer<typeof activityStreamsDTOSchema>;

export function toStreamMetadata(row: StreamSnapshot | null): StreamMetadata {
  return {
    generation: row?.generation ?? null,
    revision: row?.revision ?? '0',
    // No age limit: only invalidation (source edits, webhooks, deletion)
    // makes a stored set stale. `expires_at` is kept for compatibility.
    state: !row?.fetchedAt
      ? 'not_fetched'
      : row.invalidatedAt
        ? 'stale'
        : 'current',
    fetch_status: row?.lastAttemptStatus ?? 'not_fetched',
    available_types: row?.availableTypes ?? [],
    fetched_at: row?.fetchedAt?.toISOString() ?? null,
    expires_at: null,
  };
}
export function toActivityStreamsDTO(
  activityId: string,
  row: StreamSnapshot | null,
): ActivityStreamsDTO {
  const metadata = toStreamMetadata(row);
  return activityStreamsDTOSchema.parse({
    activity_id: activityId,
    metadata,
    requested_types: [...ACTIVITY_STREAM_TYPES],
    // Preserve last-good storage, but never serve expired/invalidated samples.
    streams: metadata.state === 'current' ? (row?.payload ?? null) : null,
    last_error: row?.lastError ?? null,
    next_retry_at: row?.nextRetryAt?.toISOString() ?? null,
  });
}
