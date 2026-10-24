import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';
import { activitiesRepository } from '~/server/repositories/activities';
import { changesRepository } from '~/server/repositories/changes';
import { photosRepository } from '~/server/repositories/photos';
import { createPlaceMatchingRepository } from '~/server/repositories/place-matching';
import { summaryReconciliationRepository } from '~/server/repositories/summary-reconciliation';

import { createSyncBootstrapHandler } from './handler';

const ROUTE = 'GET /api/v1/sync/bootstrap';

export const GET = withAuthenticatedApiV1(
  (request, context) =>
    createSyncBootstrapHandler({
      resolveActor: context.actor,
      activitiesRepo: activitiesRepository,
      photosRepo: photosRepository,
      changesRepo: changesRepository,
      freshnessRepo: summaryReconciliationRepository,
      placesRepo: createPlaceMatchingRepository(),
      onError: (error, requestId) => {
        logger.error('GET /api/v1/sync/bootstrap failed', { error, requestId });
      },
    })(request),
  { route: ROUTE, cache: 'private-no-store' },
);
