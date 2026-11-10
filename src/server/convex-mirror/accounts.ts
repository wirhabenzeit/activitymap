import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';

import { db } from '~/server/db';
import { type Writer, accounts, users } from '~/server/db/schema';
import { logger } from '~/server/logging/logger';
import { convexWriteBridge } from '~/server/sync/convex-writer';

import { type CopyState, copyState } from './copy-state';
import { moveLibraryToConvex } from './handoff-run';
import { type MirrorPosition, catalogueFor } from './mirror';
import { postgresMirrorSource, shadowActor } from './postgres-source';

/**
 * Moving every account to Convex, in two steps an operator runs from the
 * admin page:
 *
 * 1. **Prepare.** The account gets a library in Convex (an owner record)
 *    and its routing epoch is recorded on the user. From then on the mirror
 *    copies the account like any shadow owner, a time slice per run, until
 *    Convex holds the whole library. Nothing changes for the account.
 * 2. **Move.** The handoff (`handoff.ts`) for every prepared account whose
 *    copy has finished: Convex becomes the writer, and with that the
 *    account's reads come from Convex.
 */

type OwnerState = {
  backend: string;
  epoch: string;
  revoked: boolean;
  mirror: MirrorPosition | null;
};

const token = () => randomBytes(24).toString('base64url');

/** Accounts with a connected Strava athlete, oldest first. */
function connectedAccounts() {
  return db
    .select({
      id: users.id,
      name: users.name,
      writer: users.writer,
      convexEpoch: users.convexEpoch,
    })
    .from(users)
    .innerJoin(
      accounts,
      and(eq(accounts.userId, users.id), eq(accounts.providerId, 'strava')),
    )
    .where(
      and(
        isNotNull(users.athlete_id),
        isNull(accounts.revokedAt),
        isNull(accounts.scheduledErasureAt),
      ),
    )
    .orderBy(asc(users.createdAt), asc(users.id));
}

async function ownerState(userId: string) {
  const actor = await shadowActor(userId);
  const bridge = convexWriteBridge(actor);
  if (!bridge) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
  return {
    actor,
    bridge,
    state: await bridge.write<OwnerState | null>({ kind: 'state' }),
  };
}

/** Give an account a library in Convex and start copying it. Safe to run
 * again: an account that already has one is left as it is. */
export async function prepareLibraryInConvex(userId: string) {
  const { actor, bridge, state } = await ownerState(userId);
  let owner = state;
  if (!owner) {
    // The catalogue identity the account's Postgres results were matched
    // with; the mirror selects a newer one when Postgres moves on.
    const { version } = await postgresMirrorSource(actor).matches([]);
    await bridge.write({
      kind: 'provision',
      epoch: token(),
      generation: token(),
      catalogue: catalogueFor(version),
      matchingVersion: version,
    });
    owner = await bridge.write<OwnerState | null>({ kind: 'state' });
    logger.info('Provisioned a library in Convex', { userId });
  }
  if (!owner || owner.revoked || owner.backend !== 'convex')
    throw new Error('The account cannot be served from Convex');
  await db
    .update(users)
    .set({ convexEpoch: owner.epoch })
    .where(eq(users.id, userId));
  return copyState(owner);
}

export type AccountMoveStatus = {
  name: string;
  writer: Writer;
  copy: CopyState;
};

/** Every connected account, with who writes it and how far its copy is. */
export async function libraryMoveStatus(): Promise<AccountMoveStatus[]> {
  const rows = await connectedAccounts();
  return Promise.all(
    rows.map(async (row, index) => ({
      name: row.name ?? `Account ${index + 1}`,
      writer: row.writer,
      copy: row.convexEpoch
        ? copyState((await ownerState(row.id)).state)
        : ('none' as const),
    })),
  );
}

type Outcome = { name: string; result: string };

async function each(
  rows: Awaited<ReturnType<typeof connectedAccounts>>,
  budgetMs: number,
  work: (userId: string) => Promise<string>,
): Promise<Outcome[]> {
  const deadline = Date.now() + budgetMs;
  const outcomes: Outcome[] = [];
  for (const [index, row] of rows.entries()) {
    const name = row.name ?? `Account ${index + 1}`;
    if (Date.now() > deadline) {
      outcomes.push({ name, result: 'not reached in time; run again' });
      continue;
    }
    try {
      outcomes.push({ name, result: await work(row.id) });
    } catch (error) {
      logger.error('Library move step failed', { userId: row.id, error });
      outcomes.push({
        name,
        result: `failed: ${error instanceof Error ? error.message : 'error'}`,
      });
    }
  }
  return outcomes;
}

/** Prepare every account Postgres still writes that has no library in
 * Convex yet. */
export async function prepareAllLibraries() {
  const rows = (await connectedAccounts()).filter(
    (row) => row.writer === 'postgres' && !row.convexEpoch,
  );
  return each(rows, 30_000, async (userId) =>
    (await prepareLibraryInConvex(userId)) === 'ready'
      ? 'already copied'
      : 'copy started',
  );
}

/** Move every prepared account whose copy has finished. One account that
 * stops (its stores differ, or its copy was not quite at the head) does not
 * hold up the others. */
export async function moveReadyLibraries() {
  const rows = (await connectedAccounts()).filter(
    (row) => row.writer !== 'convex' && row.convexEpoch,
  );
  return each(rows, 20_000, async (userId) => {
    if (copyState((await ownerState(userId)).state) !== 'ready')
      return 'still copying';
    const report = await moveLibraryToConvex(userId);
    return report.outcome === 'aborted'
      ? `stopped: ${report.reason}`
      : 'moved to Convex';
  });
}
