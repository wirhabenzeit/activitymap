import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { convexAuthRecords } from '~/server/auth/convex-records';
import { authStoreIsConvex } from '~/server/auth/store';
import { logger } from '~/server/logging/logger';
import { previewDataUnavailable } from '~/server/preview/selection';
import { accountDeletionRepository } from '~/server/repositories/erasure';
import { deleteAccountOnConvex } from '~/server/strava/convex-webhook';

import { createAccountDeletionHandler } from './handler';

const ROUTE = 'POST /api/v1/account/delete';

export const POST = withAuthenticatedApiV1(
  async (request, context) => {
    const unavailable = await previewDataUnavailable(
      context.actor,
      context.requestId,
    );
    if (unavailable) return unavailable;
    return createAccountDeletionHandler({
      resolveSession: async () => {
        const session = await context.session();
        return session
          ? { userId: session.user.id, token: session.session.token }
          : null;
      },
      // The caller's session is checked again where the records live, then
      // the library and the records are erased.
      deleteForSession: async (userId, token, now) => {
        if (!authStoreIsConvex())
          return accountDeletionRepository.deleteForSession(userId, token, now);
        if (!(await convexAuthRecords().hasSession(userId, token, now)))
          return false;
        return deleteAccountOnConvex(userId);
      },
      onError: (error, requestId) =>
        logger.error('Account deletion failed', { error, requestId }),
    })(request);
  },
  { route: ROUTE, cache: 'private-no-store' },
);
