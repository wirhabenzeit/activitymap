import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';

import { createMergeActivitiesHandler } from './handler';

const ROUTE = 'POST /api/v1/activity-merges';

// Reads the parts, builds and uploads the file, then waits for Strava.
export const maxDuration = 60;
export async function POST(request: Request) {
  return withAuthenticatedApiV1(
    (request, context) =>
      createMergeActivitiesHandler({
        resolveActor: context.actor,
        onError: (error, requestId) =>
          logger.error('Activity merge failed', { error, requestId }),
      })(request),
    { route: ROUTE, cache: 'private-no-store' },
  )(request);
}
