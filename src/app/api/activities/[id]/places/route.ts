import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';
import { createPlaceMatchingRepository } from '~/server/repositories/place-matching';

import { createActivityPlacesHandler } from './handler';

/** Read-only compatibility route for shipped clients. Current web and iOS
 * clients render synchronized bundles; backend jobs own all matching, so a
 * pending result stays pending here until the scheduled matcher reaches it. */
export const maxDuration = 30;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedApiV1(
    async (request, context) => {
      const { id } = await params;
      return createActivityPlacesHandler({
        resolveActor: context.actor,
        read: (actor, activityId) =>
          createPlaceMatchingRepository().read(actor, activityId),
        onError: () =>
          logger.error('Place results read failed', {
            requestId: context.requestId,
          }),
      })(request, id);
    },
    { route: 'GET /api/activities/{id}/places', cache: 'private-no-store' },
  )(request);
}
