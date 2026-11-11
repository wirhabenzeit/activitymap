import { INGESTION_STATUS_MAX_AGE_SECONDS } from '~/contracts/v1/ingestion-status';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { libraryFor, notAuthenticated } from '~/server/library';
import { logger } from '~/server/logging/logger';

import { createIngestionStatusHandler } from './handler';

const ROUTE = 'GET /api/v1/ingestion-status';

export const GET = withAuthenticatedApiV1(
  async (request, context) => {
    const library = await libraryFor(await context.actor());
    if (!library) return notAuthenticated(context.requestId);
    return createIngestionStatusHandler({
      resolveActor: context.actor,
      loadStatus: library.loadStatus,
      onError: (error, requestId) => {
        logger.error('GET /api/v1/ingestion-status failed', {
          error,
          requestId,
        });
      },
    })(request);
  },
  {
    route: ROUTE,
    cache: { privateMaxAgeSeconds: INGESTION_STATUS_MAX_AGE_SECONDS },
  },
);
