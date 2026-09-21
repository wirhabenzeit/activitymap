import { auth } from '~/lib/auth';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { logger } from '~/server/logging/logger';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { createRevokeSessionHandler } from './handler';

const ROUTE = 'POST /api/v1/auth/sessions/revoke';

export const POST = withApiV1Observability(
  withApiV1RateLimit(
    createRevokeSessionHandler({
      isAuthenticated: async (headers) => {
        const session = await auth.api.getSession({ headers });
        return Boolean(session);
      },
      revokeSessionByToken: async (token, headers) => {
        await auth.api.revokeSession({ headers, body: { token } });
      },
      onError: (error, requestId) => {
        logger.error('POST /api/v1/auth/sessions/revoke failed', {
          error,
          requestId,
        });
      },
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
