import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { compressSyncResponse } from '~/server/api/sync-compression';
import { libraryFor, notAuthenticated } from '~/server/library';
import { logger } from '~/server/logging/logger';

import { createSyncChangesHandler } from './handler';

const ROUTE = 'GET /api/v1/sync/changes';

const handle = withAuthenticatedApiV1(
  async (request, context) => {
    const library = await libraryFor(await context.actor());
    if (!library) return notAuthenticated(context.requestId);
    return createSyncChangesHandler({
      resolveActor: context.actor,
      activitiesRepo: library.activitiesRepo,
      photosRepo: library.photosRepo,
      changesRepo: library.changesRepo,
      cursorBackend: library.cursorBackend,
      itemByteBudget: 2 * 1024 * 1024,
      freshnessRepo: library.freshnessRepo,
      placesRepo: library.placesRepo,
      onError: (error, requestId) => {
        logger.error('GET /api/v1/sync/changes failed', { error, requestId });
      },
    })(request);
  },
  { route: ROUTE, cache: 'private-no-store' },
);

export async function GET(request: Request) {
  return compressSyncResponse(request, await handle(request));
}
