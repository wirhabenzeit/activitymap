import { auth } from '~/lib/auth';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';

import { createListSessionsHandler } from './handler';

const ROUTE = 'GET /api/v1/auth/sessions';

export const GET = withAuthenticatedApiV1(
  (request, context) =>
    createListSessionsHandler({
      resolveSessions: async (headers) => {
        const session = await context.session();
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
    })(request),
  { route: ROUTE, cache: 'private-no-store' },
);
