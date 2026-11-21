import { withApiV1Observability } from '~/server/api/observability';
import {
  STRICT_IP_RATE_LIMIT,
  withApiV1RateLimit,
} from '~/server/api/rate-limit-boundary';
import {
  buildStravaAppAuthorizationUrl,
  startStravaAppAttempt,
  stravaAppAuthorizationConfig,
} from '~/server/auth/strava-app-attempt';
import { stravaAccessEnabled } from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';

import { createStravaAppAttemptHandler } from './handler';

const ROUTE = 'POST /api/v1/auth/mobile/strava/attempt';

export const POST = withApiV1Observability(
  withApiV1RateLimit(
    createStravaAppAttemptHandler({
      loadConfig: () =>
        stravaAccessEnabled() ? stravaAppAuthorizationConfig() : null,
      startAttempt: startStravaAppAttempt,
      buildAuthorizationUrl: buildStravaAppAuthorizationUrl,
      onError: (error, requestId) => {
        logger.error(`${ROUTE} failed`, { error, requestId });
      },
    }),
    // Pre-auth: every attempt writes a record, so guard against flooding.
    {
      route: ROUTE,
      ipGroup: { name: 'mobile-oauth', rule: STRICT_IP_RATE_LIMIT },
    },
  ),
  { route: ROUTE },
);
