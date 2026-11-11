import { withJobLog } from '~/server/application/job-log';
import { authStoreIsConvex } from '~/server/auth/store';
import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
} from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';
import { eraseDueAccountsOnConvex } from '~/server/strava/convex-webhook';
import { eraseDueRevokedAthletes } from '~/server/strava/erasure';

import { createErasureCronHandler } from './handler';

/**
 * Production-only executor for Strava's 30-day deauthorization erasure
 * deadline. The database service revalidates every candidate under a row
 * lock and performs each athlete's deletion in one transaction.
 */
export const POST = createErasureCronHandler({
  externalEffectsEnabled,
  externalEffectsDisabledMessage: EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  getCronSecret: () => process.env.CRON_SECRET,
  eraseDue: authStoreIsConvex()
    ? async () => {
        const { candidates, erased, cancelled, failed } =
          await eraseDueAccountsOnConvex();
        return { candidates, erased, cancelled, stale: 0, failed };
      }
    : withJobLog('erase-revoked-athletes', eraseDueRevokedAthletes),
  onError: (message, error) => logger.error(message, error),
});
