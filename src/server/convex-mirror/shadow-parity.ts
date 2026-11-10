import 'server-only';

import { toActivityStreamSummaryDTO } from '~/contracts/v1/activity-streams';
import { convexAppAdapter } from '~/server/preview/convex';
import { convexWriteBridge } from '~/server/sync/convex-writer';

import type { MirrorPosition } from './mirror';
import { checkParity } from './parity';
import { postgresParitySource, shadowActor } from './postgres-source';

/** Compare what Postgres and Convex hold for a mirrored account (the hourly
 * check, and the check a handoff makes before Convex becomes the writer). */
export async function checkShadowParity(userId: string) {
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
      photos: (ids) => convex.photosByActivities(ids),
      summaries: async (ids) =>
        (await convex.streams.readSummaries(actor, ids)).map(
          toActivityStreamSummaryDTO,
        ),
    },
  });
}
