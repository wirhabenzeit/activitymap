import 'server-only';

import { and, asc, eq, gt, inArray, isNotNull, lte, ne, or } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import {
  accounts,
  activityDeletions,
  photoDeletions,
  stravaWebhookEvents,
  sessions,
  users,
  verification,
} from '~/server/db/schema';

type DrizzleDb = typeof defaultDb;
type Transaction = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

/** Shared cleanup for scheduled erasure and an explicit account deletion. */
async function eraseUserData(
  tx: Transaction,
  user: { id: string; athleteId: number | null; email: string | null },
  accountIds: string[],
): Promise<boolean> {
  const athleteIds = [
    ...new Set(
      [
        user.athleteId,
        ...accountIds.map((id) => athleteIdFrom(id, null)),
      ].filter((id): id is number => id !== null),
    ),
  ];
  if (athleteIds.length) {
    // These tables have no user foreign key.
    await tx
      .delete(stravaWebhookEvents)
      .where(inArray(stravaWebhookEvents.ownerId, athleteIds));
    await tx
      .delete(activityDeletions)
      .where(inArray(activityDeletions.athlete_id, athleteIds));
    await tx
      .delete(photoDeletions)
      .where(inArray(photoDeletions.athlete_id, athleteIds));
  }
  await tx
    .delete(verification)
    .where(
      inArray(
        verification.identifier,
        user.email ? [user.id, user.email] : [user.id],
      ),
    );
  // Accounts, sessions, login codes, activities, photos, streams, shares and
  // ingestion/sync state cascade. The user lock fences concurrent FK writes:
  // writes committed first are erased; later writes cannot reference this user.
  const [deleted] = await tx
    .delete(users)
    .where(eq(users.id, user.id))
    .returning({ id: users.id });
  return Boolean(deleted);
}

/** Revalidate the caller's session inside the same transaction as deletion. */
export function createAccountDeletionRepository(
  database: DrizzleDb = defaultDb,
) {
  return {
    async deleteForSession(
      userId: string,
      token: string,
      now: Date,
    ): Promise<boolean> {
      return database.transaction(async (tx) => {
        const [user] = await tx
          .select({
            id: users.id,
            athleteId: users.athlete_id,
            email: users.email,
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        if (!user) return false;
        const [session] = await tx
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.userId, userId),
              eq(sessions.token, token),
              gt(sessions.expiresAt, now),
            ),
          )
          .for('update');
        if (!session) return false;
        const linked = await tx
          .select({ accountId: accounts.accountId })
          .from(accounts)
          .where(
            and(eq(accounts.userId, userId), eq(accounts.providerId, 'strava')),
          )
          .orderBy(asc(accounts.id))
          .for('update');
        return eraseUserData(
          tx,
          user,
          linked.map((account) => account.accountId),
        );
      });
    },
  };
}

export const accountDeletionRepository = createAccountDeletionRepository();

export type DueErasureCandidate = {
  accountId: string;
  userId: string;
  scheduledErasureAt: Date;
};

export type ErasureOutcome = 'erased' | 'cancelled' | 'stale';

export interface ErasureRepository {
  listDue(limit: number, now: Date): Promise<DueErasureCandidate[]>;
  erase(candidate: DueErasureCandidate, now: Date): Promise<ErasureOutcome>;
}

function hasStoredCredential(account: {
  accessToken: string | null;
  access_token: string | null;
  refreshToken: string | null;
  refresh_token: string | null;
}): boolean {
  return Boolean(
    account.accessToken ??
    account.access_token ??
    account.refreshToken ??
    account.refresh_token,
  );
}

function athleteIdFrom(
  accountId: string,
  athleteId: number | null,
): number | null {
  if (athleteId !== null) return athleteId;
  const parsed = Number(accountId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Database boundary for the 30-day Strava deauthorization erasure required
 * by docs/strava-data-policy.md §3.
 *
 * `erase` rechecks and locks both the due account and its user before it
 * deletes anything. That makes overlapping cron runs idempotent and closes
 * the important reconnect race: a fresh credential cancels the scheduled
 * erasure instead of deleting an athlete who has authorized the app again.
 */
export function createErasureRepository(
  database: DrizzleDb = defaultDb,
): ErasureRepository {
  return {
    async listDue(limit, now) {
      return database
        .select({
          accountId: accounts.id,
          userId: accounts.userId,
          scheduledErasureAt: accounts.scheduledErasureAt,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.providerId, 'strava'),
            isNotNull(accounts.revokedAt),
            isNotNull(accounts.scheduledErasureAt),
            lte(accounts.scheduledErasureAt, now),
          ),
        )
        .orderBy(asc(accounts.scheduledErasureAt))
        .limit(limit) as Promise<DueErasureCandidate[]>;
    },

    async erase(candidate, now) {
      return database.transaction(async (tx) => {
        // Lock the user first, then the account. Every worker follows the
        // same order, so two stale account rows for one user cannot deadlock
        // overlapping cron runs by each locking a different account first.
        const [lockedUser] = await tx
          .select({
            id: users.id,
            athleteId: users.athlete_id,
            email: users.email,
          })
          .from(users)
          .where(eq(users.id, candidate.userId))
          .for('update');

        if (!lockedUser) return 'stale';

        const [due] = await tx
          .select({
            id: accounts.id,
            accountId: accounts.accountId,
            userId: accounts.userId,
            accessToken: accounts.accessToken,
            access_token: accounts.access_token,
            refreshToken: accounts.refreshToken,
            refresh_token: accounts.refresh_token,
          })
          .from(accounts)
          .where(
            and(
              eq(accounts.id, candidate.accountId),
              eq(accounts.userId, candidate.userId),
              eq(accounts.providerId, 'strava'),
              isNotNull(accounts.revokedAt),
              isNotNull(accounts.scheduledErasureAt),
              lte(accounts.scheduledErasureAt, now),
            ),
          )
          .for('update');

        if (!due) return 'stale';

        if (hasStoredCredential(due)) {
          await tx
            .update(accounts)
            .set({ revokedAt: null, scheduledErasureAt: null })
            .where(eq(accounts.id, due.id));
          return 'cancelled';
        }

        const [otherLiveAccount] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, due.userId),
              eq(accounts.providerId, 'strava'),
              ne(accounts.id, due.id),
              or(
                isNotNull(accounts.accessToken),
                isNotNull(accounts.access_token),
                isNotNull(accounts.refreshToken),
                isNotNull(accounts.refresh_token),
              ),
            ),
          )
          .limit(1)
          .for('update');

        if (otherLiveAccount) {
          await tx.delete(accounts).where(eq(accounts.id, due.id));
          return 'cancelled';
        }

        return (await eraseUserData(tx, lockedUser, [due.accountId]))
          ? 'erased'
          : 'stale';
      });
    },
  };
}

export const erasureRepository = createErasureRepository();
