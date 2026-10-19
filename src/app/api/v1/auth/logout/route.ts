import { auth } from '~/lib/auth';
import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { logger } from '~/server/logging/logger';

import { createLogoutHandler } from './handler';

const ROUTE = 'POST /api/v1/auth/logout';

export const POST = withAuthenticatedApiV1(
  (request, context) =>
    createLogoutHandler({
      resolveCurrentSessionToken: async () => {
        const session = await context.session();
        return session?.session?.token ?? null;
      },
      revokeSessionByToken: async (token, headers) => {
        await auth.api.revokeSession({ headers, body: { token } });
      },
      onError: (error, requestId) => {
        logger.error('POST /api/v1/auth/logout failed', { error, requestId });
      },
    })(request),
  { route: ROUTE, cache: 'private-no-store' },
);
