import { photoDTOSchema, toPhotoDTO } from '~/contracts/v1/photo';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { libraryFor, notAuthenticated } from '~/server/library';
import { logger } from '~/server/logging/logger';

import { createListHandler } from '../list-handler';

const ROUTE = 'GET /api/v1/photos';

export const GET = withAuthenticatedApiV1(
  async (request, context) => {
    const library = await libraryFor(await context.actor());
    if (!library) return notAuthenticated(context.requestId);
    return createListHandler({
      resolveActor: context.actor,
      itemSchema: photoDTOSchema,
      findPage: (
        athleteId,
        { afterKey, limit }: { afterKey?: string; limit: number },
      ) =>
        library.photosRepo.findPageByAthlete(athleteId, {
          afterId: afterKey,
          limit,
        }),
      parseCursorKey: (key): string => key,
      cursorScope: `${library.cursorBackend}.list-photos`,
      cursorKeyFor: (photo) => photo.unique_id,
      toItem: toPhotoDTO,
      onError: (error, requestId) => {
        logger.error('GET /api/v1/photos failed', { error, requestId });
      },
    })(request);
  },
  { route: ROUTE, cache: 'private-no-store' },
);
