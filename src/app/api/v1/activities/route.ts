import { activityDTOSchema, toActivityDTO } from '~/contracts/v1/activity';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { firstFetch, libraryFor, notAuthenticated } from '~/server/library';
import { logger } from '~/server/logging/logger';

import { createListHandler } from '../list-handler';
import { createFetchActivitySummariesHandler } from './[id]/mutation-handler';

const ROUTE = 'GET /api/v1/activities';
export const maxDuration = 60;

/** The first fetch after signing up: start reading the provider's list. */
export const POST = withAuthenticatedApiV1(
  async (request, context) =>
    createFetchActivitySummariesHandler({
      resolveActor: context.actor,
      fetchSummaries: firstFetch,
      onError: (error, requestId) =>
        logger.error('Summary fetch failed', { error, requestId }),
    })(request),
  { route: 'POST /api/v1/activities', cache: 'private-no-store' },
);

export const GET = withAuthenticatedApiV1(
  async (request, context) => {
    const library = await libraryFor(await context.actor());
    if (!library) return notAuthenticated(context.requestId);
    return createListHandler({
      resolveActor: context.actor,
      itemSchema: activityDTOSchema,
      findPage: (
        athleteId,
        { afterKey, limit }: { afterKey?: number; limit: number },
      ) =>
        library.activitiesRepo.findPageByAthlete(athleteId, {
          afterId: afterKey,
          limit,
        }),
      parseCursorKey: (key): number | null => {
        const parsed = Number(key);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
      },
      cursorScope: `${library.cursorBackend}.list-activities`,
      cursorKeyFor: (activity) => String(activity.id),
      toItem: toActivityDTO,
      onError: (error, requestId) => {
        logger.error('GET /api/v1/activities failed', { error, requestId });
      },
    })(request);
  },
  { route: ROUTE, cache: 'private-no-store' },
);
