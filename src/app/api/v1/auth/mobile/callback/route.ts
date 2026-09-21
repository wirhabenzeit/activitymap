import { getSessionCookie } from 'better-auth/cookies';

import { auth } from '~/lib/auth';
import { issueMobileLoginCode } from '~/server/auth/mobile';
import { logger } from '~/server/logging/logger';
import { withApiV1Observability } from '~/server/api/observability';
import { createMobileAuthCallbackHandler } from './handler';

export const GET = withApiV1Observability(
  createMobileAuthCallbackHandler({
    resolveSessionUserId: async (headers) => {
      const session = await auth.api.getSession({ headers });
      return session?.user?.id ?? null;
    },
    // The signed session cookie value Better Auth just set for the browser
    // session that completed the Strava OAuth round trip *is* a valid
    // bearer token: the `bearer` plugin (`~/lib/auth.ts`) accepts any
    // request-signed value in this same format, and `getSessionCookie` is
    // Better Auth's own documented helper for reading it without a DB
    // round trip. See `~/server/auth/mobile.ts`'s decision record.
    extractSessionBearerToken: (request) => getSessionCookie(request),
    issueLoginCode: issueMobileLoginCode,
    onError: (error, requestId) => {
      logger.error('GET /api/v1/auth/mobile/callback failed', {
        error,
        requestId,
      });
    },
  }),
  { route: 'GET /api/v1/auth/mobile/callback' },
);
