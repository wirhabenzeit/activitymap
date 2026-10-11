import { auth } from '~/lib/auth';
import { resolveRequestSession } from '~/server/auth/request-session';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { logger } from '~/server/logging/logger';
import { accountDeletionRepository } from '~/server/repositories/erasure';
import { createAccountDeletionHandler } from './handler';

const ROUTE = 'POST /api/v1/account/delete';

export const POST = withApiV1Observability(
  withApiV1RateLimit(
    createAccountDeletionHandler({
      resolveSession: async (headers) => {
        const session = await resolveRequestSession(
          { headers },
          ({ headers }) => auth.api.getSession({ headers }),
        );
        return session
          ? { userId: session.user.id, token: session.session.token }
          : null;
      },
      deleteForSession: (userId, token, now) =>
        accountDeletionRepository.deleteForSession(userId, token, now),
      onError: (error, requestId) =>
        logger.error('Account deletion failed', { error, requestId }),
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
