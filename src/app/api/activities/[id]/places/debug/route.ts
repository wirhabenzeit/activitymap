import { createPlaceDebugHandler } from '~/app/api/debug/places/handler';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';
import { previewDataUnavailable } from '~/server/preview/selection';
import { createOnDemandPlacesRepository } from '~/server/repositories/on-demand-places';

export const maxDuration = 30;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedApiV1(
    async (request, context) => {
      const unavailable = await previewDataUnavailable(
        context.actor,
        context.requestId,
      );
      if (unavailable) return unavailable;
      const { id } = await params;
      return createPlaceDebugHandler({
        resolveActor: context.actor,
        debug: createOnDemandPlacesRepository().debug,
        onError: () =>
          logger.error('Debug place matching failed', {
            requestId: context.requestId,
          }),
      })(request, id);
    },
    {
      route: 'POST /api/activities/{id}/places/debug',
      cache: 'private-no-store',
    },
  )(request);
}
