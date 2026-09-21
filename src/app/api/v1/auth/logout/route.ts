import { auth } from '~/lib/auth';
import { logger } from '~/server/logging/logger';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { createLogoutHandler } from './handler';

const ROUTE = 'POST /api/v1/auth/logout';

export const POST = withApiV1Observability(
  withApiV1RateLimit(
    createLogoutHandler({
      resolveCurrentSessionToken: async (headers) => {
        const session = await auth.api.getSession({ headers });
        return session?.session?.token ?? null;
      },
      revokeSessionByToken: async (token, headers) => {
        await auth.api.revokeSession({ headers, body: { token } });
      },
      onError: (error, requestId) => {
        logger.error('POST /api/v1/auth/logout failed', { error, requestId });
      },
    }),
    { route: ROUTE },
  ),
  { route: ROUTE },
);
