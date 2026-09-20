import { z } from 'zod';

import { isoDateTime } from './primitives';

/**
 * Safe authentication metadata returned by authenticated v1 endpoints.
 * This describes the ActivityMap session that authorized the request; it
 * never contains the reusable session credential or any Strava token.
 */
export const authenticationDTOSchema = z.object({
  method: z.enum(['cookie', 'bearer']),
  sessionExpiresAt: isoDateTime,
});

export type AuthenticationDTO = z.infer<typeof authenticationDTOSchema>;

export function toAuthenticationDTO(
  method: AuthenticationDTO['method'],
  sessionExpiresAt: Date,
): AuthenticationDTO {
  return authenticationDTOSchema.parse({
    method,
    sessionExpiresAt: sessionExpiresAt.toISOString(),
  });
}
