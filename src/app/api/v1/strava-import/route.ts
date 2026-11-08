import { after } from 'next/server';

import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import {
  runStravaImport,
  startStravaImport,
} from '~/server/application/strava-import';
import { stravaAccessEnabled } from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';
import { previewDataUnavailable } from '~/server/preview/selection';
import { stravaImportRepository } from '~/server/repositories/strava-import';

import { createStravaImportHandler } from './handler';

export const maxDuration = 60;
const dependencies = {
  read: (actor: Parameters<typeof startStravaImport>[0]) =>
    stravaImportRepository.read(actor, stravaAccessEnabled()),
  start: startStravaImport,
  run: (claim: Parameters<typeof runStravaImport>[0], timeMs: number) =>
    runStravaImport(claim, { timeMs }),
  afterResponse: after,
  onError: (error: unknown, requestId: string) =>
    logger.error('Strava import failed', { error, requestId }),
};
export const GET = withAuthenticatedApiV1(
  async (request, context) => {
    const unavailable = await previewDataUnavailable(
      context.actor,
      context.requestId,
    );
    if (unavailable) return unavailable;
    return createStravaImportHandler(
      { ...dependencies, resolveActor: context.actor },
      'GET',
    )(request);
  },
  { route: 'GET /api/v1/strava-import', cache: 'private-no-store' },
);
export const POST = withAuthenticatedApiV1(
  async (request, context) => {
    const unavailable = await previewDataUnavailable(
      context.actor,
      context.requestId,
    );
    if (unavailable) return unavailable;
    return createStravaImportHandler(
      { ...dependencies, resolveActor: context.actor },
      'POST',
    )(request);
  },
  { route: 'POST /api/v1/strava-import', cache: 'private-no-store' },
);
