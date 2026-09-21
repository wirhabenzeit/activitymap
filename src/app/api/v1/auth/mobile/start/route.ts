import { auth } from '~/lib/auth';
import { logger } from '~/server/logging/logger';
import { withApiV1Observability } from '~/server/api/observability';
import {
  STRICT_IP_RATE_LIMIT,
  withApiV1RateLimit,
} from '~/server/api/rate-limit-boundary';
import { createMobileAuthStartHandler } from './handler';

const ROUTE = 'GET /api/v1/auth/mobile/start';

export const GET = withApiV1Observability(
  withApiV1RateLimit(
    createMobileAuthStartHandler({
      startSocialSignIn: async ({ callbackURL, headers }) => {
        const result = await auth.api.signInSocial({
          body: { provider: 'strava', callbackURL },
          headers,
        });
        return result && 'url' in result && typeof result.url === 'string'
          ? { url: result.url }
          : null;
      },
      onError: (error, requestId) => {
        logger.error('GET /api/v1/auth/mobile/start failed', { error, requestId });
      },
    }),
    // Pre-auth: no session credential exists yet, so IP is the only signal.
    // Kept tight since this kicks off a full Strava OAuth round trip.
    { route: ROUTE, ipRule: STRICT_IP_RATE_LIMIT },
  ),
  { route: ROUTE },
);
