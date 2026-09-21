import { logger } from '~/server/logging/logger';
import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
} from '~/server/config/external-effects';
import { rateLimitRepository } from '~/server/repositories/rate-limit';
import { createCleanupRateLimitsCronHandler } from './handler';

/**
 * Scheduled cleanup of expired `api_rate_limit_bucket` rows (issue #127).
 * This repository has no `vercel.json` - like `/api/cron/drain-webhook-inbox`
 * and `/api/cron/erase-revoked-athletes`, this route is instead triggered by
 * a GitHub Actions workflow (`.github/workflows/cleanup-rate-limits.yml`) on
 * a cron schedule, authenticated the same way: an `x-cron-secret` header
 * matching `CRON_SECRET`, and `externalEffectsEnabled()` fails closed
 * outside Production.
 */
export const POST = createCleanupRateLimitsCronHandler({
  externalEffectsEnabled,
  externalEffectsDisabledMessage: EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  getCronSecret: () => process.env.CRON_SECRET,
  deleteWindowsBefore: (cutoff) => rateLimitRepository.deleteWindowsBefore(cutoff),
  onError: (message, error) => logger.error(message, error),
});
