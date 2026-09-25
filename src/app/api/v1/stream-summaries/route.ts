import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { resolveActor } from '~/server/auth/actor';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { logger } from '~/server/logging/logger';
import { createActivityStreamsRepository } from '~/server/repositories/activity-streams';
import { createStreamSummariesHandler } from './handler';

const ROUTE = 'GET /api/v1/stream-summaries';
export const GET = withApiV1Observability(
  withApiV1RateLimit(
    createStreamSummariesHandler({
      resolveActor: (request) => resolveActor(request.headers),
      repository: createActivityStreamsRepository(),
      onError: (error, requestId) =>
        logger.error('Stream summaries request failed', { error, requestId }),
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
