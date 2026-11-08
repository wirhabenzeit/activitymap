import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { previewDataUnavailable } from '~/server/preview/selection';

import { shareLinkDependencies } from '../dependencies';
import { createShareLinksHandler } from '../handler';

export const POST = withAuthenticatedApiV1(
  async (request, context) => {
    const unavailable = await previewDataUnavailable(
      context.actor,
      context.requestId,
    );
    if (unavailable) return unavailable;
    return createShareLinksHandler(
      { ...shareLinkDependencies, resolveActor: context.actor },
      'revoke',
    )(request);
  },
  { route: 'POST /api/v1/share-links/revoke', cache: 'private-no-store' },
);
