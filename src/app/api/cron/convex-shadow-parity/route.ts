import { checkShadowParity } from '~/server/convex-mirror/shadow-parity';
import { mirroredOwners } from '~/server/convex-mirror/shadow-run';
import { logger } from '~/server/logging/logger';
import { writerOf } from '~/server/repositories/writers';

import { createConvexParityCronHandler } from './handler';

export const maxDuration = 60;
export const POST = createConvexParityCronHandler({
  // Same switch as the shadow writes it checks.
  owners: mirroredOwners,
  secret: () => process.env.CRON_SECRET,
  // Once Convex writes for an account, Postgres is no longer a copy of it
  // and there is nothing to compare.
  check: async (userId) =>
    (await writerOf(userId)) === 'convex'
      ? {
          status: 'ok',
          copy: 'not-started',
          checkpoint: null,
          sampled: 0,
          inFlight: 0,
          compared: { activities: 0, summaries: 0, photos: 0 },
          expectedDifferences: {},
          differences: {},
        }
      : checkShadowParity(userId),
  onReport: (report, userId) =>
    report.status === 'drift'
      ? logger.error('Convex shadow parity drift', { userId, ...report })
      : logger.info('Convex shadow parity', { userId, ...report }),
  onError: (error, userId) =>
    logger.error('Convex shadow parity check failed', { error, userId }),
});
