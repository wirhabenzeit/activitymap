import { auth } from '~/lib/auth';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';

import { createRevokeSessionHandler } from './handler';

const ROUTE = 'POST /api/v1/auth/sessions/revoke';

export const POST = withAuthenticatedApiV1(
  (request, context) =>
    createRevokeSessionHandler({
      isAuthenticated: async () => {
        const session = await context.session();
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
    })(request),
  { route: ROUTE, cache: 'private-no-store' },
);
