import { photoDTOSchema, toPhotoDTO } from '~/contracts/v1/photo';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';
import { convexPreviewFor } from '~/server/preview/convex';
import { photosRepository } from '~/server/repositories/photos';

import { createListHandler } from '../list-handler';

const ROUTE = 'GET /api/v1/photos';

export const GET = withAuthenticatedApiV1(
  async (request, context) => {
    const preview = convexPreviewFor(await context.actor());
    return createListHandler({
      resolveActor: context.actor,
      itemSchema: photoDTOSchema,
      findPage: (
        athleteId,
        { afterKey, limit }: { afterKey?: string; limit: number },
      ) =>
        (preview?.photosRepo ?? photosRepository).findPageByAthlete(athleteId, {
          afterId: afterKey,
          limit,
        }),
      parseCursorKey: (key): string => key,
      cursorScope: preview ? `${preview.cursorBackend}.list-photos` : undefined,
      cursorKeyFor: (photo) => photo.unique_id,
      toItem: toPhotoDTO,
      onError: (error, requestId) => {
        logger.error('GET /api/v1/photos failed', { error, requestId });
      },
    })(request);
  },
  { route: ROUTE, cache: 'private-no-store' },
);
