import { photoDTOSchema, toPhotoDTO } from '~/contracts/v1/photo';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { resolveActor } from '~/server/auth/actor';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { logger } from '~/server/logging/logger';
import { photosRepository } from '~/server/repositories/photos';
import { createListHandler } from '../list-handler';

const ROUTE = 'GET /api/v1/photos';

export const GET = withApiV1Observability(
  withApiV1RateLimit(
    createListHandler({
      resolveActor: (request) => resolveActor(request.headers),
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
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
