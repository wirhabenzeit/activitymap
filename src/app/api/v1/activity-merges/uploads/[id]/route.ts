import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';

import { createContinueMergeUploadHandler } from '../../handler';

const ROUTE = 'POST /api/v1/activity-merges/uploads/{id}';

export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedApiV1(
    async (request, context) => {
      const { id } = await params;
      return createContinueMergeUploadHandler({
        resolveActor: context.actor,
        onError: (error, requestId) =>
          logger.error('Merged upload check failed', { error, requestId }),
      })(request, id);
    },
    { route: ROUTE, cache: 'private-no-store' },
  )(request);
}
