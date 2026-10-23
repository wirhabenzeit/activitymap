import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';
import { createOnDemandPlacesRepository } from '~/server/repositories/on-demand-places';

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
        match: createOnDemandPlacesRepository().match,
        onError: () =>
          logger.error('On-demand place matching failed', {
            requestId: context.requestId,
          }),
      })(request, id);
    },
    { route: 'GET /api/activities/{id}/places', cache: 'private-no-store' },
  )(request);
}
