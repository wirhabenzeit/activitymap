import { externalEffectsEnabled } from '~/server/config/external-effects';
import { mirrorOwner } from '~/server/convex-mirror/mirror';
import {
  postgresMirrorSource,
  shadowActor,
  uploadRecording,
} from '~/server/convex-mirror/postgres-source';
import { logger } from '~/server/logging/logger';
import { convexWriteBridge } from '~/server/sync/convex-writer';

import { createConvexShadowCronHandler, shadowOwners } from './handler';

export const maxDuration = 60;
export const POST = createConvexShadowCronHandler({
  // Off unless owners are listed explicitly and automated external effects
  // are enabled for this deployment.
  owners: () =>
    externalEffectsEnabled()
      ? shadowOwners(process.env.ACTIVITYMAP_CONVEX_SHADOW_OWNERS)
      : null,
  secret: () => process.env.CRON_SECRET,
  run: async (userId, deadline) => {
    const actor = await shadowActor(userId);
    const writer = convexWriteBridge(actor);
    if (!writer) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
    const result = await mirrorOwner({
      source: postgresMirrorSource(actor),
      writer,
      upload: uploadRecording,
      deadline,
    });
    logger.info('Convex shadow write', { userId, ...result });
    return result;
  },
  onError: (error, userId) =>
    logger.error('Convex shadow write failed', { error, userId }),
});
