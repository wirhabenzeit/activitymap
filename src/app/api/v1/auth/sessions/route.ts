import { auth } from '~/lib/auth';
import { logger } from '~/server/logging/logger';
import { createListSessionsHandler } from './handler';

export const GET = createListSessionsHandler({
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
});
