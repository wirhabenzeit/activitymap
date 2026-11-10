import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';
import { authorizedStreams } from '~/server/preview/authorized-streams';
import { convexPreviewFor, convexReadOwnerFor } from '~/server/preview/convex';
import { createActivityStreamsRepository } from '~/server/repositories/activity-streams';

import { createStreamSummariesHandler } from './handler';

const ROUTE = 'GET /api/v1/stream-summaries';
export const GET = withAuthenticatedApiV1(
  async (request, context) => {
    const actor = await context.actor();
    const postgres = createActivityStreamsRepository();
    const copy = convexReadOwnerFor(actor)?.streams;
    return createStreamSummariesHandler({
      resolveActor: context.actor,
      // A read owner's summaries come from Convex, released by Postgres.
      repository:
        convexPreviewFor(actor)?.streams ??
        (copy ? authorizedStreams(copy, postgres) : postgres),
      onError: (error, requestId) =>
        logger.error('Stream summaries request failed', { error, requestId }),
    })(request);
  },
  { route: ROUTE, cache: 'private-no-store' },
);
