import { auth } from '~/lib/auth';
import { logger } from '~/server/logging/logger';
import { createMobileAuthStartHandler } from './handler';

export const GET = createMobileAuthStartHandler({
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
});
