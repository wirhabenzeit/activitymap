import { JOB_LOG_RETENTION_MS, withJobLog } from '~/server/application/job-log';
import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
} from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';
import { rateLimitRepository } from '~/server/repositories/rate-limit';
import { scheduledJobLogRepository } from '~/server/repositories/scheduled-job-log';

import { createCleanupRateLimitsCronHandler } from './handler';

/**
 * Scheduled cleanup of expired `api_rate_limit_bucket` rows (issue #127).
 * The Cloudflare Worker calls this route hourly with an `x-cron-secret`
 * header matching `CRON_SECRET`. `externalEffectsEnabled()` fails closed
 * outside Production.
 */
export const POST = createCleanupRateLimitsCronHandler({
  externalEffectsEnabled,
  externalEffectsDisabledMessage: EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  getCronSecret: () => process.env.CRON_SECRET,
  deleteWindowsBefore: withJobLog(
    'cleanup-rate-limits',
    async (cutoff: Date) => {
      const deleted = await rateLimitRepository.deleteWindowsBefore(cutoff);
      // The admin dashboard's run history is kept for a fixed window too.
      try {
        await scheduledJobLogRepository.deleteBefore(
          new Date(Date.now() - JOB_LOG_RETENTION_MS),
        );
      } catch (error) {
        logger.error('[Job log] Failed to prune old runs', error);
      }
      return deleted;
    },
    { summarize: (deleted) => ({ deleted }) },
  ),
  onError: (message, error) => logger.error(message, error),
});
