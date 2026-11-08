import { z } from 'zod';

/**
 * Real Strava deliveries are a few hundred bytes; anything far larger is
 * not a Strava event and must not be buffered or stored in the inbox.
 */
export const WEBHOOK_MAX_BODY_BYTES = 16 * 1024;

/** Strava's `updates` carry a handful of short fields (title, type, private, authorized). */
const WEBHOOK_MAX_UPDATE_KEYS = 16;

const stravaId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const updatesSchema = z
  .record(
    z.string().max(64),
    z.union([z.string().max(2048), z.boolean(), z.number()]),
  )
  .refine((value) => Object.keys(value).length <= WEBHOOK_MAX_UPDATE_KEYS, {
    message: `updates may contain at most ${WEBHOOK_MAX_UPDATE_KEYS} fields`,
  });

/** Validates an inbound Strava webhook delivery before it is durably recorded. */
export const webhookEventSchema = z.object({
  object_type: z.enum(['activity', 'athlete']),
  object_id: stravaId,
  aspect_type: z.enum(['create', 'update', 'delete']),
  owner_id: stravaId,
  subscription_id: stravaId,
  // Unix seconds. Bounded so a delivery cannot mint an unbounded range of
  // distinct inbox keys or an invalid Date.
  event_time: z.number().int().positive().max(4_102_444_800), // 2100-01-01
  updates: updatesSchema.optional(),
});
