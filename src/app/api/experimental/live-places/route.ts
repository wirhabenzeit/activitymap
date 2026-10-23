import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { localPlacesEnabled } from '~/server/config/local-places';
import { logger } from '~/server/logging/logger';
import { matchLivePlaces } from '~/server/places/live-matching';

import { createLivePlacesHandler } from './handler';

export const POST = withAuthenticatedApiV1(
  (request, context) =>
    createLivePlacesHandler({
      enabled: localPlacesEnabled,
      resolveActor: context.actor,
      match: matchLivePlaces,
      onError: () =>
        logger.error('Local live place matching failed', {
          requestId: context.requestId,
        }),
    })(request),
  { route: 'POST /api/experimental/live-places', cache: 'private-no-store' },
);
