import { backfillActivityPhotos } from '~/server/application/photo-backfill';
import {
  recordJobDisabled,
  withJobHeartbeat,
} from '~/server/application/job-heartbeat';
import { externalEffectsEnabled } from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';
import { createPhotoBackfillCronHandler } from './handler';

export const maxDuration = 60;
export const POST = createPhotoBackfillCronHandler({
  externalEffectsEnabled,
  isProduction: () => process.env.VERCEL_ENV === 'production',
  isEnabled: () => process.env.ACTIVITYMAP_PHOTO_BACKFILL === 'enabled',
  getCronSecret: () => process.env.CRON_SECRET,
  backfill: withJobHeartbeat(
    'backfill-activity-photos',
    backfillActivityPhotos,
    (result) => result.stopReason,
  ),
  onDisabled: () => recordJobDisabled('backfill-activity-photos'),
  onError: (error) => logger.error('[Photo backfill] Cycle failed', error),
});
