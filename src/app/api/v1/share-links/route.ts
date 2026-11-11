import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';

import { shareLinkDependencies } from './dependencies';
import { createShareLinksHandler } from './handler';

export const GET = withAuthenticatedApiV1(
  async (request, context) => {
    return createShareLinksHandler(
      { ...shareLinkDependencies, resolveActor: context.actor },
      'list',
    )(request);
  },
  { route: 'GET /api/v1/share-links', cache: 'private-no-store' },
);
export const POST = withAuthenticatedApiV1(
  async (request, context) => {
    return createShareLinksHandler(
      { ...shareLinkDependencies, resolveActor: context.actor },
      'create',
    )(request);
  },
  { route: 'POST /api/v1/share-links', cache: 'private-no-store' },
);
