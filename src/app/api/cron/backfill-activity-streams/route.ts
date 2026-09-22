import { backfillActivityStreams } from '~/server/application/stream-backfill';
import { externalEffectsEnabled } from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';
import { createStreamBackfillCronHandler } from './handler';

export const maxDuration = 60;
export const POST = createStreamBackfillCronHandler({
  externalEffectsEnabled,
  isProduction: () => process.env.VERCEL_ENV === 'production',
  isEnabled: () => process.env.ACTIVITYMAP_STREAM_BACKFILL === 'enabled',
  getCronSecret: () => process.env.CRON_SECRET,
  backfill: backfillActivityStreams,
  onResult: (result) => logger.info('[Stream backfill] Cycle complete', result),
  onError: (error) => logger.error('[Stream backfill] Cycle failed', error),
});
