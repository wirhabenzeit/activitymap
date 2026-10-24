import { withJobLog } from '~/server/application/job-log';
import { processPlaceMatching } from '~/server/application/place-matching';
import { externalEffectsEnabled } from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';

import { createPlaceMatchingCronHandler } from './handler';

export const maxDuration = 60;
export const POST = createPlaceMatchingCronHandler({
  enabled: () =>
    process.env.VERCEL_ENV === 'production' && externalEffectsEnabled(),
  secret: () => process.env.CRON_SECRET,
  run: withJobLog('match-activity-places', processPlaceMatching, {
    stopReason: (result) => result.stopReason,
  }),
  onError: (error) => logger.error('Place matching cycle failed', error),
});
