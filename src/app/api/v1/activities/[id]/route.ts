import { after } from 'next/server';

import { parseMutationActivityId } from '~/server/api/activity-id';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { mirrorShadowOwnerAfterWrite } from '~/server/convex-mirror/shadow-run';
import { logger } from '~/server/logging/logger';
import { previewDataUnavailable } from '~/server/preview/selection';

import { createUpdateActivityHandler } from './mutation-handler';

const ROUTE = 'PATCH /api/v1/activities/{id}';

export const maxDuration = 60;
export async function PATCH(
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
      const response = await createUpdateActivityHandler({
        resolveActor: context.actor,
        onError: (error, requestId) =>
          logger.error('Activity update request failed', { error, requestId }),
      })(request, parseMutationActivityId(id));
      if (response.ok) {
        // Shadow owners: copy the edit to Convex once the response is sent.
        const actor = await context.actor();
        if (actor) after(() => mirrorShadowOwnerAfterWrite(actor.userId));
      }
      return response;
    },
    { route: ROUTE, cache: 'private-no-store' },
  )(request);
}
