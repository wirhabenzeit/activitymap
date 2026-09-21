import { auth } from '~/lib/auth';
import { resolveRateLimitUserId } from '~/server/auth/rate-limit-user';
import { logger } from '~/server/logging/logger';
import { withApiV1Observability } from '~/server/api/observability';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { createListSessionsHandler } from './handler';

const ROUTE = 'GET /api/v1/auth/sessions';

export const GET = withApiV1Observability(
  withApiV1RateLimit(
    createListSessionsHandler({
      resolveSessions: async (headers) => {
        const session = await auth.api.getSession({ headers });
        if (!session) return null;

        const sessions = await auth.api.listSessions({ headers });
        return {
          currentToken: session.session.token,
          sessions: (sessions ?? []).map((entry) => ({
            token: entry.token,
            createdAt: new Date(entry.createdAt),
            expiresAt: new Date(entry.expiresAt),
            ipAddress: entry.ipAddress ?? null,
            userAgent: entry.userAgent ?? null,
          })),
        };
      },
      onError: (error, requestId) => {
        logger.error('GET /api/v1/auth/sessions failed', { error, requestId });
      },
    }),
    { route: ROUTE, resolveUserId: resolveRateLimitUserId },
  ),
  { route: ROUTE },
);
