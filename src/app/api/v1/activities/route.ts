import { after } from 'next/server';

import { activityDTOSchema, toActivityDTO } from '~/contracts/v1/activity';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import {
  ActivityMutationError,
  fetchInitialActivitySummariesForActor,
} from '~/server/application/activities';
import { warmSignupActivitiesForActor } from '~/server/application/signup-warmup';
import { LibraryMoving } from '~/server/convex-mirror/new-accounts';
import { firstFetchFromConvex } from '~/server/convex-mirror/new-accounts-run';
import { logger } from '~/server/logging/logger';
import { convexReadsFor } from '~/server/preview/convex';
import { previewDataUnavailable } from '~/server/preview/selection';
import { activitiesRepository } from '~/server/repositories/activities';

import { createListHandler } from '../list-handler';
import { createFetchActivitySummariesHandler } from './[id]/mutation-handler';

const ROUTE = 'GET /api/v1/activities';
export const maxDuration = 60;

export const POST = withAuthenticatedApiV1(
  async (request, context) => {
    const unavailable = await previewDataUnavailable(
      context.actor,
      context.requestId,
    );
    if (unavailable) return unavailable;
    // Whether this request was served from Convex: a new account that
    // starts there, or one Convex already writes.
    let fromConvex = false;
    return createFetchActivitySummariesHandler({
      resolveActor: context.actor,
      afterResponse: after,
      fetchSummaries: async (actor) => {
        let count: number | null;
        try {
          count = await firstFetchFromConvex(actor);
        } catch (error) {
          if (!(error instanceof LibraryMoving)) throw error;
          throw new ActivityMutationError(
            'local_state_conflict',
            error.message,
            503,
            true,
            60,
          );
        }
        if (count === null) return fetchInitialActivitySummariesForActor(actor);
        fromConvex = true;
        return count;
      },
      warmSignup: async (actor, count, options) => {
        // The warmup reads and writes Postgres; in Convex the sweep
        // completes the newest activities first.
        if (fromConvex) return null;
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
    })(request);
  },
  { route: 'POST /api/v1/activities', cache: 'private-no-store' },
);

export const GET = withAuthenticatedApiV1(
  async (request, context) => {
    const preview = convexReadsFor(await context.actor());
    return createListHandler({
      resolveActor: context.actor,
      itemSchema: activityDTOSchema,
      findPage: (
        athleteId,
        { afterKey, limit }: { afterKey?: number; limit: number },
      ) =>
        (preview?.activitiesRepo ?? activitiesRepository).findPageByAthlete(
          athleteId,
          {
            afterId: afterKey,
            limit,
          },
        ),
      parseCursorKey: (key): number | null => {
        const parsed = Number(key);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
      },
      cursorScope: preview
        ? `${preview.cursorBackend}.list-activities`
        : undefined,
      cursorKeyFor: (activity) => String(activity.id),
      toItem: toActivityDTO,
      onError: (error, requestId) => {
        logger.error('GET /api/v1/activities failed', { error, requestId });
      },
    })(request);
  },
  { route: ROUTE, cache: 'private-no-store' },
);
