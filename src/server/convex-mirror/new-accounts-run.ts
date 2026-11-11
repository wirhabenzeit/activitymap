import 'server-only';

import { eq } from 'drizzle-orm';

import type { Actor } from '~/server/auth/actor';
import { externalEffectsEnabled } from '~/server/config/external-effects';
import { db } from '~/server/db';
import { users } from '~/server/db/schema';
import { logger } from '~/server/logging/logger';
import { convexAppAdapter } from '~/server/preview/convex';
import { activitiesRepository } from '~/server/repositories/activities';
import { convexWriteBridge } from '~/server/sync/convex-writer';

import { prepareLibraryInConvex } from './accounts';
import { moveLibraryToConvex } from './handoff-run';
import { firstFetchThroughConvex } from './new-accounts';

/** `ACTIVITYMAP_CONVEX_NEW_ACCOUNTS=enabled` starts new accounts on Convex. */
export function newAccountsOnConvex(
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    environment.ACTIVITYMAP_CONVEX_NEW_ACCOUNTS === 'enabled' &&
    externalEffectsEnabled(environment)
  );
}

/** The first fetch of an account's activities, when Convex serves it
 * (new-accounts.ts); null when it belongs to the Postgres path. */
export function firstFetchFromConvex(actor: Actor): Promise<number | null> {
  const bridge = () => {
    const writer = convexWriteBridge(actor);
    if (!writer) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
    return writer;
  };
  const epoch = async () => {
    const state = await bridge().write<{ epoch: string } | null>({
      kind: 'state',
    });
    if (!state) throw new Error('The owner is not provisioned in Convex');
    return state.epoch;
  };
  return firstFetchThroughConvex({
    enabled: newAccountsOnConvex(),
    async account() {
      const [user] = await db
        .select({ writer: users.writer, convexEpoch: users.convexEpoch })
        .from(users)
        .where(eq(users.id, actor.userId));
      if (!user) return null;
      // Asked only for an account that could be new.
      const hasActivities =
        user.writer === 'postgres' && !user.convexEpoch
          ? (
              await activitiesRepository.findPageByAthlete(actor.athleteId, {
                limit: 1,
              })
            ).length > 0
          : true;
      return { ...user, hasActivities };
    },
    prepare: () => prepareLibraryInConvex(actor.userId),
    move: () => moveLibraryToConvex(actor.userId),
    startSweep: async () => bridge().write({ kind: 'sweepNow' }, await epoch()),
    sweep: async () =>
      bridge().write<{ phase: string; page: number } | null>(
        { kind: 'sweepStatus' },
        await epoch(),
      ),
    count: async () =>
      (
        await convexAppAdapter(actor, await epoch()).loadStatus(
          actor,
          new Date(),
        )
      ).history.knownActivityCount,
    onFallback: (reason) =>
      logger.error('A new account could not start on Convex', {
        userId: actor.userId,
        reason,
      }),
  });
}
