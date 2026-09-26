import { auth } from '~/lib/auth';
import { exchangeMobileLoginCode } from '~/server/auth/mobile';
import { logger } from '~/server/logging/logger';
import { withApiV1Observability } from '~/server/api/observability';
import {
  STRICT_IP_RATE_LIMIT,
  withApiV1RateLimit,
} from '~/server/api/rate-limit-boundary';
import { createMobileExchangeHandler } from './handler';

const ROUTE = 'POST /api/v1/auth/mobile/exchange';

export const POST = withApiV1Observability(
  withApiV1RateLimit(
    createMobileExchangeHandler({
      exchangeCode: exchangeMobileLoginCode,
      resolveBearerSessionExpiry: async (bearerToken) => {
        const session = await auth.api.getSession({
          headers: new Headers({ authorization: `Bearer ${bearerToken}` }),
        });
        return session?.session?.expiresAt
          ? new Date(session.session.expiresAt)
          : null;
      },
      onError: (error, requestId) => {
        logger.error('POST /api/v1/auth/mobile/exchange failed', {
          error,
          requestId,
        });
      },
    }),
    // Pre-auth code exchange: guard against brute-forcing the one-time code.
    {
      route: ROUTE,
      ipGroup: { name: 'mobile-oauth', rule: STRICT_IP_RATE_LIMIT },
    },
  ),
  { route: ROUTE },
);
