import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { resolveActor } from '~/server/auth/actor';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { logger } from '~/server/logging/logger';

import { createUpdateActivityHandler } from './mutation-handler';

const ROUTE = 'PATCH /api/v1/activities/{id}';

export const maxDuration = 60;
export const PATCH = withApiV1Observability(
  withApiV1RateLimit(
    createUpdateActivityHandler({
      resolveActor: (request) => resolveActor(request.headers),
      onError: (error, requestId) =>
        logger.error('Activity update request failed', { error, requestId }),
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
