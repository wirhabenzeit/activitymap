import { backfillActivityStreams } from '~/server/application/stream-backfill';
import {
  recordJobDisabled,
  withJobHeartbeat,
} from '~/server/application/job-heartbeat';
import { recordJobLogDisabled, withJobLog } from '~/server/application/job-log';
import { externalEffectsEnabled } from '~/server/config/external-effects';
import { streamBackfillEnabled } from '~/server/config/stream-backfill';
import { logger } from '~/server/logging/logger';
import { createStreamBackfillCronHandler } from './handler';

export const maxDuration = 60;
export const POST = createStreamBackfillCronHandler({
  externalEffectsEnabled,
  isProduction: () => process.env.VERCEL_ENV === 'production',
  isEnabled: streamBackfillEnabled,
  getCronSecret: () => process.env.CRON_SECRET,
  backfill: withJobLog(
    'backfill-activity-streams',
    withJobHeartbeat(
      'backfill-activity-streams',
      backfillActivityStreams,
      (result) => result.stopReason,
    ),
    { stopReason: (result) => result.stopReason },
  ),
  onDisabled: async () => {
    await recordJobDisabled('backfill-activity-streams');
    await recordJobLogDisabled('backfill-activity-streams');
  },
  onResult: (result) => logger.info('[Stream backfill] Cycle complete', result),
  onError: (error) => logger.error('[Stream backfill] Cycle failed', error),
});
