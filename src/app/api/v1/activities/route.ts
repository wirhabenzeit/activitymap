import { after } from 'next/server';

import { activityDTOSchema, toActivityDTO } from '~/contracts/v1/activity';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { warmSignupActivitiesForActor } from '~/server/application/signup-warmup';
import { logger } from '~/server/logging/logger';
import { activitiesRepository } from '~/server/repositories/activities';

import { createListHandler } from '../list-handler';
import { createFetchActivitySummariesHandler } from './[id]/mutation-handler';

const ROUTE = 'GET /api/v1/activities';
export const maxDuration = 60;

export const POST = withAuthenticatedApiV1(
  (request, context) =>
    createFetchActivitySummariesHandler({
      resolveActor: context.actor,
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
    })(request),
  { route: 'POST /api/v1/activities', cache: 'private-no-store' },
);

export const GET = withAuthenticatedApiV1(
  (request, context) =>
    createListHandler({
      resolveActor: context.actor,
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
    })(request),
  { route: ROUTE, cache: 'private-no-store' },
);
