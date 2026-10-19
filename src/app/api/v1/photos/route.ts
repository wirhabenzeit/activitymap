import { photoDTOSchema, toPhotoDTO } from '~/contracts/v1/photo';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';
import { photosRepository } from '~/server/repositories/photos';

import { createListHandler } from '../list-handler';

const ROUTE = 'GET /api/v1/photos';

export const GET = withAuthenticatedApiV1(
  (request, context) =>
    createListHandler({
      resolveActor: context.actor,
      itemSchema: photoDTOSchema,
      findPage: (
        athleteId,
        { afterKey, limit }: { afterKey?: string; limit: number },
      ) =>
        photosRepository.findPageByAthlete(athleteId, {
          afterId: afterKey,
          limit,
        }),
      parseCursorKey: (key): string => key,
      cursorKeyFor: (photo) => photo.unique_id,
      toItem: toPhotoDTO,
      onError: (error, requestId) => {
        logger.error('GET /api/v1/photos failed', { error, requestId });
      },
    })(request),
  { route: ROUTE, cache: 'private-no-store' },
);
