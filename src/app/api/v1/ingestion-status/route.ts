import { INGESTION_STATUS_MAX_AGE_SECONDS } from '~/contracts/v1/ingestion-status';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { deriveIngestionStatus } from '~/server/application/ingestion-status';
import { photoBackfillEnabled } from '~/server/config/photo-backfill';
import { streamBackfillEnabled } from '~/server/config/stream-backfill';
import { logger } from '~/server/logging/logger';
import { ingestionStatusRepository } from '~/server/repositories/ingestion-status';

import { createIngestionStatusHandler } from './handler';

const ROUTE = 'GET /api/v1/ingestion-status';

export const GET = withAuthenticatedApiV1(
  (request, context) =>
    createIngestionStatusHandler({
      resolveActor: context.actor,
      loadStatus: async (actor, observedAt) =>
        deriveIngestionStatus(
          await ingestionStatusRepository.snapshot(
            actor.userId,
            actor.athleteId,
            observedAt,
          ),
          {
            photoBackfillEnabled: photoBackfillEnabled(),
            streamBackfillEnabled: streamBackfillEnabled(),
          },
        ),
      onError: (error, requestId) => {
        logger.error('GET /api/v1/ingestion-status failed', {
          error,
          requestId,
        });
      },
    })(request),
  {
    route: ROUTE,
    cache: { privateMaxAgeSeconds: INGESTION_STATUS_MAX_AGE_SECONDS },
  },
);
