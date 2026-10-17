import { after } from 'next/server';
import { activityDTOSchema, toActivityDTO } from '~/contracts/v1/activity';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { resolveActor } from '~/server/auth/actor';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { warmSignupActivitiesForActor } from '~/server/application/signup-warmup';
import { logger } from '~/server/logging/logger';
import { activitiesRepository } from '~/server/repositories/activities';
import { createListHandler } from '../list-handler';
import { createFetchActivitySummariesHandler } from './[id]/mutation-handler';

const ROUTE = 'GET /api/v1/activities';
export const maxDuration = 60;

export const POST = withApiV1Observability(
  withApiV1RateLimit(
    createFetchActivitySummariesHandler({
      resolveActor: (request) => resolveActor(request.headers),
      afterResponse: after,
      warmSignup: async (actor, count, options) => {
        const result = await warmSignupActivitiesForActor(
          actor,
          count,
          options,
        );
        logger.info('Signup warmup finished', result);
        return result;
      },
      onError: (error, requestId) =>
        logger.error('Summary fetch failed', { error, requestId }),
    }),
    { route: 'POST /api/v1/activities', resolveUserId: resolveRateLimitUserId },
  ),
  { route: 'POST /api/v1/activities' },
);

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
