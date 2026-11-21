import { randomUUID } from 'node:crypto';

import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  mobileExchangeResponseDTOSchema,
  stravaAppCompleteRequestSchema,
  toMobileExchangeResponseDTO,
} from '~/contracts/v1/mobile-auth';
import { MobileAuthError } from '~/server/auth/mobile';
import { StravaAppSignInError } from '~/server/auth/strava-app-sign-in-error';
import { requestIdFor } from '~/server/http/request-id';

export interface StravaAppCompleteHandlerDependencies {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  /** Consumes the attempt `state` belongs to; throws `MobileAuthError`. */
  consumeAttempt: (input: {
    state: string;
    pkceVerifier: string;
  }) => Promise<void>;
  /** Exchanges the code with Strava and mints the ActivityMap session. */
  signIn: (input: {
    code: string;
    scope?: string;
    headers: Headers;
  }) => Promise<{ bearerToken: string }>;
  /** As in the code exchange: confirms the session resolves, and its expiry. */
  resolveBearerSessionExpiry: (bearerToken: string) => Promise<Date | null>;
}

/**
 * `POST /api/v1/auth/mobile/strava/complete` (issue #305): the app presents
 * what the installed Strava app returned, with the PKCE verifier of the
 * attempt it started. The attempt is consumed first and exactly once, so a
 * replayed, stale or foreign return never reaches Strava, then the session is
 * minted in this same request. No browser session is involved, so there is
 * nothing ambient to hand out.
 */
export function createStravaAppCompleteHandler({
  createRequestId = randomUUID,
  now = () => new Date(),
  onError = () => undefined,
  consumeAttempt,
  signIn,
  resolveBearerSessionExpiry,
}: StravaAppCompleteHandlerDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdFor(request, createRequestId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        errorEnvelope('validation_failed', 'Request body must be JSON.', {
          requestId,
        }),
        { status: 400 },
      );
    }
    const parsed = stravaAppCompleteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        errorEnvelope('validation_failed', 'Request body is invalid.', {
          requestId,
          details: parsed.error.flatten(),
        }),
        { status: 400 },
      );
    }

    try {
      await consumeAttempt({
        state: parsed.data.state,
        pkceVerifier: parsed.data.pkceVerifier,
      });
      const { bearerToken } = await signIn({
        code: parsed.data.code,
        scope: parsed.data.scope,
        headers: request.headers,
      });

      const sessionExpiresAt = await resolveBearerSessionExpiry(bearerToken);
      if (!sessionExpiresAt) {
        return Response.json(
          errorEnvelope(
            'not_authenticated',
            'The session is no longer valid.',
            { requestId },
          ),
          { status: 401 },
        );
      }

      return Response.json(
        responseEnvelope(mobileExchangeResponseDTOSchema).parse(
          makeEnvelope(
            toMobileExchangeResponseDTO({
              sessionToken: bearerToken,
              sessionExpiresAt,
            }),
            now(),
          ),
        ),
      );
    } catch (error) {
      if (error instanceof MobileAuthError) {
        return Response.json(
          errorEnvelope(error.code, error.message, { requestId }),
          { status: 401 },
        );
      }
      if (error instanceof StravaAppSignInError) {
        return Response.json(
          errorEnvelope(error.code, error.message, {
            requestId,
            retryable: error.retryable,
          }),
          { status: error.status },
        );
      }
      onError(error, requestId);
      return Response.json(
        errorEnvelope('internal_error', 'The request could not be completed.', {
          requestId,
          retryable: true,
        }),
        { status: 500 },
      );
    }
  };
}
