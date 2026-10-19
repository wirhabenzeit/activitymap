import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';
import { accountDeletionRepository } from '~/server/repositories/erasure';

import { createAccountDeletionHandler } from './handler';

const ROUTE = 'POST /api/v1/account/delete';

export const POST = withAuthenticatedApiV1(
  (request, context) =>
    createAccountDeletionHandler({
      resolveSession: async () => {
        const session = await context.session();
        return session
          ? { userId: session.user.id, token: session.session.token }
          : null;
      },
      deleteForSession: (userId, token, now) =>
        accountDeletionRepository.deleteForSession(userId, token, now),
      onError: (error, requestId) =>
        logger.error('Account deletion failed', { error, requestId }),
    })(request),
  { route: ROUTE, cache: 'private-no-store' },
);
