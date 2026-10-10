import { resolveActor } from '~/server/auth/actor';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { initialImportRepository } from '~/server/repositories/initial-import';
import {
  advanceInitialImport,
  presentInitialImport,
} from '~/server/application/initial-import';
import { logger } from '~/server/logging/logger';
import { createInitialImportHandler } from './handler';

export const maxDuration = 60;
const handler = createInitialImportHandler({
  resolveActor: (request) => resolveActor(request.headers),
  read: async (actor) =>
    presentInitialImport(await initialImportRepository.read(actor), new Date()),
  advance: (actor) => advanceInitialImport(actor),
  onError: (error, requestId) =>
    logger.error('Initial import request failed', { error, requestId }),
});
export const GET = withApiV1Observability(
  withApiV1RateLimit(handler, {
    route: 'GET /api/v1/initial-import',
    resolveUserId: resolveRateLimitUserId,
  }),
  { route: 'GET /api/v1/initial-import' },
);
export const POST = withApiV1Observability(
  withApiV1RateLimit(handler, {
    route: 'POST /api/v1/initial-import',
    resolveUserId: resolveRateLimitUserId,
  }),
  { route: 'POST /api/v1/initial-import' },
);
