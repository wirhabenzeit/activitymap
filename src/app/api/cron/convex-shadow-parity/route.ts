import { toActivityStreamSummaryDTO } from '~/contracts/v1/activity-streams';
import { externalEffectsEnabled } from '~/server/config/external-effects';
import type { MirrorPosition } from '~/server/convex-mirror/mirror';
import { checkParity } from '~/server/convex-mirror/parity';
import {
  postgresParitySource,
  shadowActor,
} from '~/server/convex-mirror/postgres-source';
import { logger } from '~/server/logging/logger';
import { convexAppAdapter } from '~/server/preview/convex';
import { convexWriteBridge } from '~/server/sync/convex-writer';

import { shadowOwners } from '../mirror-convex-shadow/handler';
import { createConvexParityCronHandler } from './handler';

export const maxDuration = 60;
export const POST = createConvexParityCronHandler({
  // Same switch as the shadow writes it checks.
  owners: () =>
    externalEffectsEnabled()
      ? shadowOwners(process.env.ACTIVITYMAP_CONVEX_SHADOW_OWNERS)
      : null,
  secret: () => process.env.CRON_SECRET,
  check: async (userId) => {
    const actor = await shadowActor(userId);
    const writer = convexWriteBridge(actor);
    if (!writer) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
    // The mirror's checkpoint and the epoch the read bridge requires.
    const state = await writer.write<{
      backend: string;
      epoch: string;
      revoked: boolean;
      mirror: MirrorPosition | null;
    } | null>({ kind: 'state' });
    if (!state) throw new Error('The owner is not provisioned in Convex');
    if (state.revoked || state.backend !== 'convex')
      throw new Error('The Convex owner is not assigned to Convex');
    const convex = convexAppAdapter(actor, state.epoch);
    return checkParity({
      position: state.mirror,
      postgres: postgresParitySource(actor),
      convex: {
        activities: (ids) => convex.activitiesByIds(ids),
        summaries: async (ids) =>
          (await convex.streams.readSummaries(actor, ids)).map(
            toActivityStreamSummaryDTO,
          ),
      },
    });
  },
  onReport: (report, userId) =>
    report.status === 'drift'
      ? logger.error('Convex shadow parity drift', { userId, ...report })
      : logger.info('Convex shadow parity', { userId, ...report }),
  onError: (error, userId) =>
    logger.error('Convex shadow parity check failed', { error, userId }),
});
