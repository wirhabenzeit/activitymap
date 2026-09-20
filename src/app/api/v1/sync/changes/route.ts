import { resolveActor } from '~/server/auth/actor';
import { activitiesRepository } from '~/server/repositories/activities';
import { changesRepository } from '~/server/repositories/changes';
import { photosRepository } from '~/server/repositories/photos';
import { logger } from '~/server/logging/logger';
import { createSyncChangesHandler } from './handler';

export const GET = createSyncChangesHandler({
  resolveActor: (request) => resolveActor(request.headers),
  activitiesRepo: activitiesRepository,
  photosRepo: photosRepository,
  changesRepo: changesRepository,
  onError: (error, requestId) => {
    logger.error('GET /api/v1/sync/changes failed', { error, requestId });
  },
});
