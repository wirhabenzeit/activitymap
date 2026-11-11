import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { libraryFor, notAuthenticated } from '~/server/library';
import { logger } from '~/server/logging/logger';
import { connectedStreams } from '~/server/repositories/activity-streams';

import { createStreamSummariesHandler } from '../handler';

const ROUTE = 'GET /api/v1/stream-summaries/compact';
export const GET = withAuthenticatedApiV1(
  async (request, context) => {
    const library = await libraryFor(await context.actor());
    if (!library) return notAuthenticated(context.requestId);
    return createStreamSummariesHandler({
      compact: true,
      resolveActor: context.actor,
      repository: connectedStreams(library.streams),
      onError: (error, requestId) =>
        logger.error('Stream summaries request failed', { error, requestId }),
    })(request);
  },
  { route: ROUTE, cache: 'private-no-store' },
);
