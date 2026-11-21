import { randomUUID } from 'node:crypto';

import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  stravaAppAttemptRequestSchema,
  stravaAppAttemptResponseDTOSchema,
} from '~/contracts/v1/mobile-auth';
import type { StravaAppAuthorizationConfig } from '~/server/auth/strava-app-attempt';
import { requestIdFor } from '~/server/http/request-id';

export interface StravaAppAttemptHandlerDependencies {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  /** `null` when the Strava app handoff is not available in this deployment. */
  loadConfig: () => StravaAppAuthorizationConfig | null;
  startAttempt: (input: {
    state: string;
    pkceChallenge: string;
  }) => Promise<{ expiresAt: Date }>;
  buildAuthorizationUrl: (
    config: StravaAppAuthorizationConfig,
    params: { state: string; forceConsent: boolean },
  ) => string;
}

/**
 * `POST /api/v1/auth/mobile/strava/attempt` (issue #305): registers a sign-in
 * the app is about to hand to the installed Strava app, and returns the
 * `strava://` authorization URL to open. Any failure means "use the web
 * sign-in": the client falls back, it never retries the handoff blindly.
 */
export function createStravaAppAttemptHandler({
  createRequestId = randomUUID,
  now = () => new Date(),
  onError = () => undefined,
  loadConfig,
  startAttempt,
  buildAuthorizationUrl,
}: StravaAppAttemptHandlerDependencies) {
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
    const parsed = stravaAppAttemptRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        errorEnvelope('validation_failed', 'Request body is invalid.', {
          requestId,
          details: parsed.error.flatten(),
        }),
        { status: 400 },
      );
    }

    const config = loadConfig();
    if (!config) {
      return Response.json(
        errorEnvelope(
          'strava_app_sign_in_unavailable',
          'Signing in through the Strava app is not available here. Use the web sign-in.',
          { requestId },
        ),
        { status: 503 },
      );
    }

    try {
      const { expiresAt } = await startAttempt({
        state: parsed.data.state,
        pkceChallenge: parsed.data.codeChallenge,
      });
      const authorizationUrl = buildAuthorizationUrl(config, {
        state: parsed.data.state,
        forceConsent: parsed.data.forceConsent === true,
      });
      return Response.json(
        responseEnvelope(stravaAppAttemptResponseDTOSchema).parse(
          makeEnvelope(
            { authorizationUrl, expiresAt: expiresAt.toISOString() },
            now(),
          ),
        ),
      );
    } catch (error) {
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
