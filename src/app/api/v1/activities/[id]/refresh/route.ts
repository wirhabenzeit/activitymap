import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { resolveActor } from '~/server/auth/actor';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { logger } from '~/server/logging/logger';

import { createRefreshActivityHandler } from '../mutation-handler';

const ROUTE = 'POST /api/v1/activities/{id}/refresh';

export const maxDuration = 60;
export const POST = withApiV1Observability(
  withApiV1RateLimit(
    createRefreshActivityHandler({
      resolveActor: (request) => resolveActor(request.headers),
      onError: (error, requestId) =>
        logger.error('Activity refresh request failed', { error, requestId }),
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
