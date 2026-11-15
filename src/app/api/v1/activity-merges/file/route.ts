import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';

import { createMergeFileHandler } from '../handler';

const ROUTE = 'POST /api/v1/activity-merges/file';

export const maxDuration = 60;
export async function POST(request: Request) {
  return withAuthenticatedApiV1(
    (request, context) =>
      createMergeFileHandler({
        resolveActor: context.actor,
        onError: (error, requestId) =>
          logger.error('Merged file request failed', { error, requestId }),
      })(request),
    { route: ROUTE, cache: 'private-no-store' },
  )(request);
}
