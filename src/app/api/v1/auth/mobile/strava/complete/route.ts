import { auth } from '~/lib/auth';
import { withApiV1Observability } from '~/server/api/observability';
import {
  STRICT_IP_RATE_LIMIT,
  withApiV1RateLimit,
} from '~/server/api/rate-limit-boundary';
import { consumeStravaAppAttempt } from '~/server/auth/strava-app-attempt';
import { createStravaAppSignIn } from '~/server/auth/strava-app-session';
import { logger } from '~/server/logging/logger';

import { createStravaAppCompleteHandler } from './handler';

const ROUTE = 'POST /api/v1/auth/mobile/strava/complete';

export const POST = withApiV1Observability(
  withApiV1RateLimit(
    createStravaAppCompleteHandler({
      consumeAttempt: consumeStravaAppAttempt,
      signIn: createStravaAppSignIn(auth),
      resolveBearerSessionExpiry: async (bearerToken) => {
        const session = await auth.api.getSession({
          headers: new Headers({ authorization: `Bearer ${bearerToken}` }),
        });
        return session?.session?.expiresAt
          ? new Date(session.session.expiresAt)
          : null;
      },
      onError: (error, requestId) => {
        logger.error(`${ROUTE} failed`, { error, requestId });
      },
    }),
    // Pre-auth: guard against guessing attempts and Strava code spraying.
    {
      route: ROUTE,
      ipGroup: { name: 'mobile-oauth', rule: STRICT_IP_RATE_LIMIT },
    },
  ),
  { route: ROUTE },
);
