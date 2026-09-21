import { auth } from '~/lib/auth';
import { exchangeMobileLoginCode } from '~/server/auth/mobile';
import { logger } from '~/server/logging/logger';
import { withApiV1Observability } from '~/server/api/observability';
import { createMobileExchangeHandler } from './handler';

export const POST = withApiV1Observability(
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
  { route: 'POST /api/v1/auth/mobile/exchange' },
);
