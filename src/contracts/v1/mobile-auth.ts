import { z } from 'zod';

import { isoDateTime } from './primitives';

/**
 * Request body for `POST /api/v1/auth/mobile/exchange` (issue #121). The
 * mobile client's own `state` is included so the server-side check is not
 * only a client-side CSRF guard: a code exchanged with the wrong `state`
 * is rejected server-side too (see the issue's acceptance criteria).
 */
export const mobileExchangeRequestSchema = z.object({
  code: z.string().min(1),
  pkceVerifier: z.string().min(1),
  state: z.string().min(1),
});

export type MobileExchangeRequest = z.infer<typeof mobileExchangeRequestSchema>;

/**
 * Success payload for `POST /api/v1/auth/mobile/exchange`. `sessionToken`
 * is the value SwiftUI stores in the Keychain and sends back as
 * `Authorization: Bearer <sessionToken>` - see `~/server/auth/actor.ts`.
 */
export const mobileExchangeResponseDTOSchema = z.object({
  sessionToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  sessionExpiresAt: isoDateTime,
});

export type MobileExchangeResponseDTO = z.infer<
  typeof mobileExchangeResponseDTOSchema
>;

export function toMobileExchangeResponseDTO(input: {
  sessionToken: string;
  sessionExpiresAt: Date;
}): MobileExchangeResponseDTO {
  return mobileExchangeResponseDTOSchema.parse({
    sessionToken: input.sessionToken,
    tokenType: 'Bearer',
    sessionExpiresAt: input.sessionExpiresAt.toISOString(),
  });
}

/** A single active session, as returned by `GET /api/v1/auth/sessions`. */
export const mobileSessionDTOSchema = z.object({
  token: z.string().min(1),
  createdAt: isoDateTime,
  expiresAt: isoDateTime,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  isCurrent: z.boolean(),
});

export type MobileSessionDTO = z.infer<typeof mobileSessionDTOSchema>;

export const mobileSessionListDTOSchema = z.object({
  sessions: z.array(mobileSessionDTOSchema),
});

export type MobileSessionListDTO = z.infer<typeof mobileSessionListDTOSchema>;

/** Request body for `POST /api/v1/auth/sessions/revoke`. */
export const revokeSessionRequestSchema = z.object({
  token: z.string().min(1),
});

export type RevokeSessionRequest = z.infer<typeof revokeSessionRequestSchema>;
