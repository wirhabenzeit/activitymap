import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { compressSyncResponse } from '~/server/api/sync-compression';
import { libraryFor, notAuthenticated } from '~/server/library';
import { logger } from '~/server/logging/logger';

import { createSyncBootstrapHandler } from './handler';

const ROUTE = 'GET /api/v1/sync/bootstrap';

const handle = withAuthenticatedApiV1(
  async (request, context) => {
    const library = await libraryFor(await context.actor());
    if (!library) return notAuthenticated(context.requestId);
    return createSyncBootstrapHandler({
      resolveActor: context.actor,
      activitiesRepo: library.activitiesRepo,
      photosRepo: library.photosRepo,
      changesRepo: library.changesRepo,
      cursorBackend: library.cursorBackend,
      bootstrapPage: library.bootstrapPage,
      defaultPageSize: 500,
      freshnessRepo: library.freshnessRepo,
      placesRepo: library.placesRepo,
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
