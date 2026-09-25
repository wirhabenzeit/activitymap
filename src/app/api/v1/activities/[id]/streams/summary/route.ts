import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { resolveActor } from '~/server/auth/actor';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { logger } from '~/server/logging/logger';
import { createActivityStreamsRepository } from '~/server/repositories/activity-streams';
import { createActivityStreamsHandler } from '../handler';

const ROUTE = 'GET /api/v1/activities/{id}/streams/summary';
export const maxDuration = 60;
export const GET = withApiV1Observability(
  withApiV1RateLimit(
    createActivityStreamsHandler({
      resolveActor: (request) => resolveActor(request.headers),
      repository: createActivityStreamsRepository(),
      view: 'summary',
      onError: (error, requestId) =>
        logger.error('Activity stream summary request failed', {
          error,
          requestId,
        }),
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
