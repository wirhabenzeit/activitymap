import { auth } from '~/lib/auth';
import { logger } from '~/server/logging/logger';
import { withApiV1Observability } from '~/server/api/observability';
import { createLogoutHandler } from './handler';

export const POST = withApiV1Observability(
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
  { route: 'POST /api/v1/auth/logout' },
);
