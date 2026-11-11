import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import {
  readConvexImport,
  startConvexImport,
} from '~/server/application/convex-import';
import type { Actor } from '~/server/auth/actor';
import { stravaAccessEnabled } from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';

import { createStravaImportHandler } from './handler';

export const maxDuration = 60;
// "Fetch from Strava" is the library's reconciliation sweep
// (src/server/application/convex-import.ts); it runs in the backend.
const dependencies = {
  read: (actor: Actor) => readConvexImport(actor, stravaAccessEnabled()),
  start: (actor: Actor) => startConvexImport(actor, stravaAccessEnabled()),
  onError: (error: unknown, requestId: string) =>
    logger.error('Strava import failed', { error, requestId }),
};
export const GET = withAuthenticatedApiV1(
  async (request, context) =>
    createStravaImportHandler(
      { ...dependencies, resolveActor: context.actor },
      'GET',
    )(request),
  { route: 'GET /api/v1/strava-import', cache: 'private-no-store' },
);
export const POST = withAuthenticatedApiV1(
  async (request, context) =>
    createStravaImportHandler(
      { ...dependencies, resolveActor: context.actor },
      'POST',
    )(request),
  { route: 'POST /api/v1/strava-import', cache: 'private-no-store' },
);
