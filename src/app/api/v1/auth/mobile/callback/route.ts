import { getSessionCookie } from 'better-auth/cookies';

import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { STRICT_IP_RATE_LIMIT } from '~/server/api/rate-limit-boundary';
import { issueMobileLoginCode } from '~/server/auth/mobile';
import { logger } from '~/server/logging/logger';

import { createMobileAuthCallbackHandler } from './handler';

const ROUTE = 'GET /api/v1/auth/mobile/callback';

export const GET = withAuthenticatedApiV1(
  (request, context) =>
    createMobileAuthCallbackHandler({
      resolveSessionUserId: async () => {
        const session = await context.session();
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
    })(request),
  { route: ROUTE, cache: 'passthrough' },
  {
    rateLimit: {
      ipGroup: { name: 'mobile-oauth', rule: STRICT_IP_RATE_LIMIT },
    },
  },
);
