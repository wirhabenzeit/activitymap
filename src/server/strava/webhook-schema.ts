import { z } from 'zod';

/** Validates an inbound Strava webhook delivery before it is durably recorded. */
export const webhookEventSchema = z.object({
  object_type: z.enum(['activity', 'athlete']),
  object_id: z.number(),
  aspect_type: z.enum(['create', 'update', 'delete']),
  owner_id: z.number(),
  subscription_id: z.number(),
  event_time: z.number(),
  updates: z.record(z.string(), z.unknown()).optional(),
});
