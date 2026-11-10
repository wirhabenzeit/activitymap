import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { compressSyncResponse } from '~/server/api/sync-compression';
import { logger } from '~/server/logging/logger';
import { convexReadsFor } from '~/server/preview/convex';
import { activitiesRepository } from '~/server/repositories/activities';
import { changesRepository } from '~/server/repositories/changes';
import { photosRepository } from '~/server/repositories/photos';
import { createPlaceMatchingRepository } from '~/server/repositories/place-matching';
import { summaryReconciliationRepository } from '~/server/repositories/summary-reconciliation';

import { createSyncBootstrapHandler } from './handler';

const ROUTE = 'GET /api/v1/sync/bootstrap';

const handle = withAuthenticatedApiV1(
  async (request, context) => {
    const preview = convexReadsFor(await context.actor());
    return createSyncBootstrapHandler({
      resolveActor: context.actor,
      activitiesRepo: preview?.activitiesRepo ?? activitiesRepository,
      photosRepo: preview?.photosRepo ?? photosRepository,
      changesRepo: preview?.changesRepo ?? changesRepository,
      cursorBackend: preview?.cursorBackend,
      bootstrapPage: preview?.bootstrapPage,
      defaultPageSize: preview ? 500 : undefined,
      freshnessRepo: preview?.freshnessRepo ?? summaryReconciliationRepository,
      placesRepo: preview?.placesRepo ?? createPlaceMatchingRepository(),
      onError: (error, requestId) => {
        logger.error('GET /api/v1/sync/bootstrap failed', { error, requestId });
      },
    })(request);
  },
  { route: ROUTE, cache: 'private-no-store' },
);

export async function GET(request: Request) {
  return compressSyncResponse(request, await handle(request));
}
