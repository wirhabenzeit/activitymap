import { deriveIngestionStatus } from '~/server/application/ingestion-status';
import { resolveActor } from '~/server/auth/actor';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { logger } from '~/server/logging/logger';
import { ingestionStatusRepository } from '~/server/repositories/ingestion-status';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { createIngestionStatusHandler } from './handler';

const ROUTE = 'GET /api/v1/ingestion-status';

export const GET = withApiV1Observability(
  withApiV1RateLimit(
    createIngestionStatusHandler({
      resolveActor: (request) => resolveActor(request.headers),
      loadStatus: async (actor, observedAt) =>
        deriveIngestionStatus(
          await ingestionStatusRepository.snapshot(
            actor.userId,
            actor.athleteId,
            observedAt,
          ),
          {
            // The server-side rollout switch the backfill cron also checks.
            photoBackfillEnabled:
              process.env.ACTIVITYMAP_PHOTO_BACKFILL === 'enabled' &&
              process.env.VERCEL_ENV === 'production',
            streamBackfillEnabled:
              process.env.ACTIVITYMAP_STREAM_BACKFILL === 'enabled',
          },
        ),
      onError: (error, requestId) => {
        logger.error('GET /api/v1/ingestion-status failed', {
          error,
          requestId,
        });
      },
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
