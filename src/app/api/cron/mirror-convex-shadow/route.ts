import {
  mirroredOwners,
  runCatalogueMirror,
  runShadowMirror,
} from '~/server/convex-mirror/shadow-run';
import { logger } from '~/server/logging/logger';

import { createConvexShadowCronHandler } from './handler';

export const maxDuration = 60;
export const POST = createConvexShadowCronHandler({
  // Off unless owners are listed explicitly and automated external effects
  // are enabled for this deployment.
  owners: mirroredOwners,
  secret: () => process.env.CRON_SECRET,
  run: runShadowMirror,
  onError: (error, userId) =>
    logger.error('Convex shadow write failed', { error, userId }),
  // The place catalogue is copied in what remains of each run's budget.
  shared: {
    name: 'catalogue',
    run: runCatalogueMirror,
    onError: (error) => logger.error('Convex catalogue copy failed', { error }),
  },
});
