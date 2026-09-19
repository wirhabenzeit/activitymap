import { z } from 'zod';
import { idString } from './primitives';

/**
 * The v1 wire contract for the authenticated user, e.g. for a future
 * `GET /api/v1/me` (see issue #121). This intentionally mirrors, but is
 * kept separate from, the existing RSC-only `CurrentUserDTO` in
 * `~/server/db/dto` — that type already never carries Strava credentials
 * (see issue #116) but represents `athleteId` as a number for the
 * existing web client's convenience. The v1 wire contract instead follows
 * the "large ids are strings" rule for every client, including SwiftUI.
 */
export const currentUserDTOSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  image: z.string().nullable(),
  athleteId: idString.nullable(),
  stravaConnected: z.boolean(),
});

export type CurrentUserDTOv1 = z.infer<typeof currentUserDTOSchema>;
