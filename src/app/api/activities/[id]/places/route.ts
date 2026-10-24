import { after } from 'next/server';

import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { processPlaceMatching } from '~/server/application/place-matching';
import { logger } from '~/server/logging/logger';
import { createPlaceMatchingRepository } from '~/server/repositories/place-matching';

import { createActivityPlacesHandler } from './handler';

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
        match: async (actor, activityId) => {
          const result = await createPlaceMatchingRepository().read(
            actor,
            activityId,
          );
          if (result.status === 'pending')
            after(async () => {
              try {
                await processPlaceMatching({
                  activityIds: [activityId],
                  activityLimit: 1,
                  timeMs: 10_000,
                });
              } catch (error) {
                logger.error('Requested place matching failed', error);
              }
            });
          return result;
        },
        onError: () =>
          logger.error('Place results read failed', {
            requestId: context.requestId,
          }),
      })(request, id);
    },
    { route: 'GET /api/activities/{id}/places', cache: 'private-no-store' },
  )(request);
}
