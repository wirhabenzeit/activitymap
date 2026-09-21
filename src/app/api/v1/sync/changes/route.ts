import { resolveActor } from '~/server/auth/actor';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { activitiesRepository } from '~/server/repositories/activities';
import { changesRepository } from '~/server/repositories/changes';
import { photosRepository } from '~/server/repositories/photos';
import { logger } from '~/server/logging/logger';
import { summaryReconciliationRepository } from '~/server/repositories/summary-reconciliation';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { createSyncChangesHandler } from './handler';

const ROUTE = 'GET /api/v1/sync/changes';

export const GET = withApiV1Observability(
  withApiV1RateLimit(
    createSyncChangesHandler({
      resolveActor: (request) => resolveActor(request.headers),
      activitiesRepo: activitiesRepository,
      photosRepo: photosRepository,
      changesRepo: changesRepository,
      freshnessRepo: summaryReconciliationRepository,
      onError: (error, requestId) => {
        logger.error('GET /api/v1/sync/changes failed', { error, requestId });
      },
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
