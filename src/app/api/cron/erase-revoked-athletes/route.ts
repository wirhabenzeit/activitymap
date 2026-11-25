import { convexAuthStore } from '~/server/auth/convex-adapter';
import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
} from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';
import { eraseDueAccountsOnConvex } from '~/server/strava/convex-webhook';

import { createErasureCronHandler } from './handler';

/**
 * Production-only executor for Strava's 30-day deauthorization erasure
 * deadline. Each due account's library is erased in Convex, then its
 * sign-in records (`~/server/strava/convex-webhook.ts`).
 */
export const POST = createErasureCronHandler({
  externalEffectsEnabled,
  externalEffectsDisabledMessage: EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  getCronSecret: () => process.env.CRON_SECRET,
  eraseDue: async () => {
    const { candidates, erased, cancelled, failed } =
      await eraseDueAccountsOnConvex();
    return { candidates, erased, cancelled, stale: 0, failed };
  },
  // Shown on /admin (backend/convex/jobHealth.ts).
  onSucceeded: () =>
    convexAuthStore()({
      kind: 'jobSucceeded',
      job: 'erase-revoked-athletes',
    }),
  onError: (message, error) => logger.error(message, error),
});
