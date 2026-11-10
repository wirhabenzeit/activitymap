import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';
import { authorizedStreams } from '~/server/preview/authorized-streams';
import { convexPreviewFor, convexReadOwnerFor } from '~/server/preview/convex';
import { createActivityStreamsRepository } from '~/server/repositories/activity-streams';
import { streamActivityIdSchema } from '~/server/strava/streams';

import { createActivityStreamsHandler } from './handler';

const ROUTE = 'GET /api/v1/activities/{id}/streams';
export const maxDuration = 60;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedApiV1(
    async (request, context) => {
      const { id } = await params;
      const actor = await context.actor();
      const repository = createActivityStreamsRepository();
      const copy = convexReadOwnerFor(actor)?.streams;
      return createActivityStreamsHandler({
        resolveActor: context.actor,
        repository,
        storedOnly: convexPreviewFor(actor)?.streams,
        // Postgres stays the authority on who may read these streams.
        preferred: copy && authorizedStreams(copy, repository),
        onPreferredError: (error, requestId) =>
          logger.warn('Convex stream read failed; using Postgres', {
            error,
            requestId,
          }),
        onError: (error, requestId) =>
          logger.error('Activity streams request failed', { error, requestId }),
      })(request, streamActivityIdSchema.safeParse(id).success ? id : null);
    },
    { route: ROUTE, cache: 'private-no-store' },
  )(request);
}
