import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';

import { shareLinkDependencies } from '../dependencies';
import { createShareLinksHandler } from '../handler';

export const POST = withAuthenticatedApiV1(
  (request, context) =>
    createShareLinksHandler(
      { ...shareLinkDependencies, resolveActor: context.actor },
      'revoke',
    )(request),
  { route: 'POST /api/v1/share-links/revoke', cache: 'private-no-store' },
);
