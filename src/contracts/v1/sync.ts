import { z } from 'zod';
import { activityDTOSchema } from './activity';
import { photoDTOSchema } from './photo';
import { idString, isoDateTime } from './primitives';

/**
 * The v1 wire shape of the existing `/api/offline/bootstrap` and
 * `/api/offline/changes` responses. This is a lossless snapshot/delta, not
 * yet the paginated, cursor-based protocol from issue #123 — that ticket
 * introduces `/api/v1/sync/bootstrap` and `/api/v1/sync/changes` as the
 * paginated, replay-safe replacement for these routes (issue #126 then
 * migrates the web client onto it). Applying the v1 DTOs here now closes
 * the "API responses return Drizzle rows directly" gap immediately without
 * waiting on that larger protocol change.
 */
export const offlineSyncPayloadDTOSchema = z.object({
  activities: z.array(activityDTOSchema),
  photos: z.array(photoDTOSchema),
  deletedActivityIds: z.array(idString),
  deletedPhotoIds: z.array(z.string()),
  cursor: isoDateTime,
  serverTime: isoDateTime,
});

export type OfflineSyncPayloadDTO = z.infer<typeof offlineSyncPayloadDTOSchema>;
