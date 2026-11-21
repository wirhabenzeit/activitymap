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

/**
 * Request body for `POST /api/v1/auth/mobile/strava/attempt` (issue #305): the
 * app registers the `state` and PKCE challenge of a sign-in it is about to
 * hand to the installed Strava app. Strava's installed-app route returns to
 * the app without any browser cookie, so this server-side attempt is what the
 * return is later checked against.
 */
export const stravaAppAttemptRequestSchema = z.object({
  state: z.string().min(16).max(256),
  codeChallenge: z.string().min(16).max(256),
  /** Show Strava's consent screen even if the app is already authorised. */
  forceConsent: z.boolean().optional(),
});

export type StravaAppAttemptRequest = z.infer<
  typeof stravaAppAttemptRequestSchema
>;

/** Where the app sends the person to authorize in the installed Strava app. */
export const stravaAppAttemptResponseDTOSchema = z.object({
  authorizationUrl: z.string().min(1),
  expiresAt: isoDateTime,
});

export type StravaAppAttemptResponseDTO = z.infer<
  typeof stravaAppAttemptResponseDTOSchema
>;

/**
 * Request body for `POST /api/v1/auth/mobile/strava/complete`: what the app
 * received from Strava (`code`, `scope`, `state`) with the PKCE verifier of
 * the attempt. The response is the same session as the code exchange.
 */
export const stravaAppCompleteRequestSchema = z.object({
  code: z.string().min(1).max(512),
  /** The scopes Strava reports the person approved. */
  scope: z.string().max(512).optional(),
  state: z.string().min(16).max(256),
  pkceVerifier: z.string().min(1).max(256),
});

export type StravaAppCompleteRequest = z.infer<
  typeof stravaAppCompleteRequestSchema
>;

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
