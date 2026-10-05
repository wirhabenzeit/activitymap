import { logger } from '~/server/logging/logger';
import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
} from '~/server/config/external-effects';
import { eraseDueRevokedAthletes } from '~/server/strava/erasure';
import { withJobLog } from '~/server/application/job-log';
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
  eraseDue: withJobLog('erase-revoked-athletes', eraseDueRevokedAthletes),
  onError: (message, error) => logger.error(message, error),
});
