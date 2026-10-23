import { visitedPlaceSchema } from '~/contracts/visited-places';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { localPlacesEnabled } from '~/server/config/local-places';
import { db } from '~/server/db';
import { logger } from '~/server/logging/logger';
import { publishedPlacesQuery } from '~/server/places/published-query';

import { createVisitedPlacesHandler } from './handler';

export const GET = withAuthenticatedApiV1(
  (_request, context) =>
    createVisitedPlacesHandler({
      enabled: localPlacesEnabled,
      resolveActor: context.actor,
      load: async (actor) =>
        visitedPlaceSchema
          .array()
          .parse((await db.execute(publishedPlacesQuery(actor))).rows),
      onError: (error) =>
        logger.error('Visited places read failed', {
          error,
          requestId: context.requestId,
        }),
    })(),
  { route: 'GET /api/experimental/visited-places', cache: 'private-no-store' },
);
