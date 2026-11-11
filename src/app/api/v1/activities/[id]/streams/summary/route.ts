import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { libraryFor, notAuthenticated } from '~/server/library';
import { logger } from '~/server/logging/logger';
import { connectedStreams } from '~/server/repositories/activity-streams';
import { streamActivityIdSchema } from '~/server/strava/streams';

import { createActivityStreamsHandler } from '../handler';

const ROUTE = 'GET /api/v1/activities/{id}/streams/summary';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedApiV1(
    async (request, context) => {
      const { id } = await params;
      const library = await libraryFor(await context.actor());
      if (!library) return notAuthenticated(context.requestId);
      return createActivityStreamsHandler({
        resolveActor: context.actor,
        repository: connectedStreams(library.streams),
        view: 'summary',
        onError: (error, requestId) =>
          logger.error('Activity stream summary request failed', {
            error,
            requestId,
          }),
      })(request, streamActivityIdSchema.safeParse(id).success ? id : null);
    },
    { route: ROUTE, cache: 'private-no-store' },
  )(request);
}
