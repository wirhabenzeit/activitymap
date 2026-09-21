import { activityDTOSchema, toActivityDTO } from '~/contracts/v1/activity';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { resolveActor } from '~/server/auth/actor';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { logger } from '~/server/logging/logger';
import { activitiesRepository } from '~/server/repositories/activities';
import { createListHandler } from '../list-handler';

const ROUTE = 'GET /api/v1/activities';

export const GET = withApiV1Observability(
  withApiV1RateLimit(
    createListHandler({
      resolveActor: (request) => resolveActor(request.headers),
      itemSchema: activityDTOSchema,
      findPage: (
        athleteId,
        { afterKey, limit }: { afterKey?: number; limit: number },
      ) =>
        activitiesRepository.findPageByAthlete(athleteId, {
          afterId: afterKey,
          limit,
        }),
      parseCursorKey: (key): number | null => {
        const parsed = Number(key);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
      },
      cursorKeyFor: (activity) => String(activity.id),
      toItem: toActivityDTO,
      onError: (error, requestId) => {
        logger.error('GET /api/v1/activities failed', { error, requestId });
      },
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
