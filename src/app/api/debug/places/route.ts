import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';

import { createPlaceDebugHandler } from './handler';

export const GET = withAuthenticatedApiV1(
  (request, context) =>
    createPlaceDebugHandler({ resolveActor: context.actor })(request),
  { route: 'GET /api/debug/places', cache: 'private-no-store' },
);
