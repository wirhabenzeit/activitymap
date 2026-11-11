import { parseMutationActivityId } from '~/server/api/activity-id';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';

import { createUpdateActivityHandler } from './mutation-handler';

const ROUTE = 'PATCH /api/v1/activities/{id}';

export const maxDuration = 60;
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedApiV1(
    async (request, context) => {
      const { id } = await params;
      return createUpdateActivityHandler({
        resolveActor: context.actor,
        onError: (error, requestId) =>
          logger.error('Activity update request failed', { error, requestId }),
      })(request, parseMutationActivityId(id));
    },
    { route: ROUTE, cache: 'private-no-store' },
  )(request);
}
