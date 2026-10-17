import { after } from 'next/server';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { resolveActor } from '~/server/auth/actor';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import {
  runStravaImport,
  startStravaImport,
} from '~/server/application/strava-import';
import { stravaAccessEnabled } from '~/server/config/external-effects';
import { stravaImportRepository } from '~/server/repositories/strava-import';
import { logger } from '~/server/logging/logger';
import { createStravaImportHandler } from './handler';

export const maxDuration = 60;
const dependencies = {
  resolveActor: (request: Request) => resolveActor(request.headers),
  read: (actor: Parameters<typeof startStravaImport>[0]) =>
    stravaImportRepository.read(actor, stravaAccessEnabled()),
  start: startStravaImport,
  run: (claim: Parameters<typeof runStravaImport>[0], timeMs: number) =>
    runStravaImport(claim, { timeMs }),
  afterResponse: after,
  onError: (error: unknown, requestId: string) =>
    logger.error('Strava import failed', { error, requestId }),
};
export const GET = withApiV1Observability(
  withApiV1RateLimit(createStravaImportHandler(dependencies, 'GET'), {
    route: 'GET /api/v1/strava-import',
    resolveUserId: resolveRateLimitUserId,
  }),
  { route: 'GET /api/v1/strava-import' },
);
export const POST = withApiV1Observability(
  withApiV1RateLimit(createStravaImportHandler(dependencies, 'POST'), {
    route: 'POST /api/v1/strava-import',
    resolveUserId: resolveRateLimitUserId,
  }),
  { route: 'POST /api/v1/strava-import' },
);
