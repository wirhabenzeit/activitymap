import { z } from 'zod';
import { authenticationDTOSchema, type AuthenticationDTO } from './auth';
import { idString, toIdString } from './primitives';

/**
 * The v1 wire contract for the authenticated user returned by
 * `GET /api/v1/me`. This intentionally mirrors, but is kept separate from,
 * the existing RSC-only `CurrentUserDTO` in
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
  authentication: authenticationDTOSchema,
});

export type CurrentUserDTOv1 = z.infer<typeof currentUserDTOSchema>;

export interface CurrentUserSource {
  athleteId: number | null;
  email: string | null;
  id: string;
  image: string | null;
  name: string | null;
  stravaConnected: boolean;
}

export function toCurrentUserDTOv1(
  user: CurrentUserSource,
  authentication: AuthenticationDTO,
): CurrentUserDTOv1 {
  return currentUserDTOSchema.parse({
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    athleteId: user.athleteId === null ? null : toIdString(user.athleteId),
    stravaConnected: user.stravaConnected,
    authentication,
  });
}
