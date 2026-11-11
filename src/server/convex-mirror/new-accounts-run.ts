import 'server-only';

import { randomBytes } from 'node:crypto';

import type { Actor } from '~/server/auth/actor';
import { authStoreIsConvex } from '~/server/auth/store';
import { externalEffectsEnabled } from '~/server/config/external-effects';
import { findUserInternal, updateUserInternal } from '~/server/db/internal';
import type { Writer } from '~/server/db/schema';
import { logger } from '~/server/logging/logger';
import { matchingVersion } from '~/server/places/matching-version';
import { convexAppAdapter } from '~/server/preview/convex';
import { activitiesRepository } from '~/server/repositories/activities';
import { convexWriteBridge } from '~/server/sync/convex-writer';

import { prepareLibraryInConvex } from './accounts';
import { moveLibraryToConvex } from './handoff-run';
import { catalogueFor } from './mirror';
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
    // With sign-in records in Convex there is no Postgres path to start on.
    enabled: newAccountsOnConvex() || authStoreIsConvex(),
    async account() {
      const user = await findUserInternal(actor.userId);
      if (!user) return null;
      // Asked only for an account that could be new. With sign-in records
      // in Convex there is no library in Postgres to find.
      const hasActivities =
        user.writer === 'postgres' && !user.convexEpoch
          ? !authStoreIsConvex() &&
            (
              await activitiesRepository.findPageByAthlete(actor.athleteId, {
                limit: 1,
              })
            ).length > 0
          : true;
      return {
        writer: user.writer,
        convexEpoch: user.convexEpoch,
        hasActivities,
      };
    },
    prepare: async () => {
      if (!authStoreIsConvex()) return prepareLibraryInConvex(actor.userId);
      // Nothing in Postgres to copy from or to hand over: the account gets
      // a library in Convex that Convex writes from the start.
      const writer = bridge();
      if (!(await writer.write({ kind: 'state' }))) {
        const rowset = await writer.write<{
          snapshotId: string;
          revision: string;
        } | null>({ kind: 'latestCatalogue' });
        const version = matchingVersion(
          rowset ?? { snapshotId: null, revision: '0' },
        );
        await writer.write({
          kind: 'provision',
          epoch: randomBytes(24).toString('base64url'),
          generation: randomBytes(24).toString('base64url'),
          catalogue: catalogueFor(version),
          matchingVersion: version,
        });
      }
    },
    move: async () => {
      if (!authStoreIsConvex()) return moveLibraryToConvex(actor.userId);
      const writer = bridge();
      const state = await writer.write<{
        epoch: string;
        writer: Writer;
        writerEpoch: number;
      } | null>({ kind: 'state' });
      if (!state) return { writer: 'postgres', reason: 'No library in Convex' };
      if (state.writer !== 'convex')
        await writer.write({
          kind: 'setWriter',
          writer: 'convex',
          expectedEpoch: state.writerEpoch,
        });
      await updateUserInternal(actor.userId, {
        writer: 'convex',
        convexEpoch: state.epoch,
      });
      return { writer: 'convex' };
    },
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
