import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';
import { createActivityStreamsRepository } from '~/server/repositories/activity-streams';

import { createStreamSummariesHandler } from '../handler';

const ROUTE = 'GET /api/v1/stream-summaries/compact';
export const GET = withAuthenticatedApiV1(
  (request, context) =>
    createStreamSummariesHandler({
      compact: true,
      resolveActor: context.actor,
      repository: createActivityStreamsRepository(),
      onError: (error, requestId) =>
        logger.error('Stream summaries request failed', { error, requestId }),
    })(request),
  { route: ROUTE, cache: 'private-no-store' },
);
