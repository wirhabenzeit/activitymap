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
        // `asResponse: true` is required to get at the `Set-Cookie` header
        // Better Auth attaches for its own OAuth state verification -
        // without it, `auth.api.signInSocial` returns only the parsed body
        // and that cookie is silently dropped, which previously made every
        // mobile sign-in fail once Strava redirected back (see the
        // handler's doc comment on `startSocialSignIn`).
        const response = await auth.api.signInSocial({
          body: { provider: 'strava', callbackURL },
          headers,
          asResponse: true,
        });
        const body: unknown = await response.json().catch(() => null);
        const url =
          body &&
          typeof body === 'object' &&
          'url' in body &&
          typeof body.url === 'string'
            ? body.url
            : null;
        return url ? { url, headers: response.headers } : null;
      },
      onError: (error, requestId) => {
        logger.error('GET /api/v1/auth/mobile/start failed', {
          error,
          requestId,
        });
      },
    }),
    // Share a tighter OAuth bucket without counting ordinary sync requests.
    {
      route: ROUTE,
      ipGroup: { name: 'mobile-oauth', rule: STRICT_IP_RATE_LIMIT },
    },
  ),
  { route: ROUTE },
);
