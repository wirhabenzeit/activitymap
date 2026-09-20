import { auth } from '~/lib/auth';
import { logger } from '~/server/logging/logger';
import { createRevokeSessionHandler } from './handler';

export const POST = createRevokeSessionHandler({
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
});
