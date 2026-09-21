import { resolveActor } from '~/server/auth/actor';
import { activitiesRepository } from '~/server/repositories/activities';
import { changesRepository } from '~/server/repositories/changes';
import { photosRepository } from '~/server/repositories/photos';
import { logger } from '~/server/logging/logger';
import { summaryReconciliationRepository } from '~/server/repositories/summary-reconciliation';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { createSyncBootstrapHandler } from './handler';

const ROUTE = 'GET /api/v1/sync/bootstrap';

export const GET = withApiV1Observability(
  withApiV1RateLimit(
    createSyncBootstrapHandler({
      resolveActor: (request) => resolveActor(request.headers),
      activitiesRepo: activitiesRepository,
      photosRepo: photosRepository,
      changesRepo: changesRepository,
      freshnessRepo: summaryReconciliationRepository,
      onError: (error, requestId) => {
        logger.error('GET /api/v1/sync/bootstrap failed', { error, requestId });
      },
    }),
    { route: ROUTE },
  ),
  { route: ROUTE },
);
