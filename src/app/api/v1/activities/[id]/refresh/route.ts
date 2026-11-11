import { parseMutationActivityId } from '~/server/api/activity-id';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';

import { createRefreshActivityHandler } from '../mutation-handler';

const ROUTE = 'POST /api/v1/activities/{id}/refresh';

export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedApiV1(
    async (request, context) => {
      const { id } = await params;
      return createRefreshActivityHandler({
        resolveActor: context.actor,
        onError: (error, requestId) =>
          logger.error('Activity refresh request failed', { error, requestId }),
      })(request, parseMutationActivityId(id));
    },
    { route: ROUTE, cache: 'private-no-store' },
  )(request);
}
