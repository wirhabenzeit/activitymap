import { and, eq, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';

import type { Actor } from '~/server/auth/actor';
import { resolveAccountTokens } from '~/server/db/account-token-normalization';
import { accounts, activities, users } from '~/server/db/schema';

export type PlaceTransaction = Parameters<
  Parameters<ReturnType<typeof drizzle>['transaction']>[0]
>[0];

export class ActivityPlacesUnavailableError extends Error {
  constructor() {
    super('Activity or eligible Strava account unavailable');
    this.name = 'ActivityPlacesUnavailableError';
  }
}

export function validatePlaceActor(actor: Actor): void {
  if (
    !actor.userId?.trim() ||
    !Number.isSafeInteger(actor.athleteId) ||
    actor.athleteId <= 0
  ) {
    throw new ActivityPlacesUnavailableError();
  }
}

/** Same user -> account order and token eligibility as stored-stream reads. */
export async function lockPlaceAccount(tx: PlaceTransaction, actor: Actor) {
  validatePlaceActor(actor);
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.id, actor.userId), eq(users.athlete_id, actor.athleteId)),
    )
    .for('key share');
  if (!user) return null;
  const [account] = await tx
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, user.id),
        eq(accounts.providerId, 'strava'),
        eq(accounts.accountId, String(actor.athleteId)),
      ),
    )
    .orderBy(accounts.id)
    .limit(1)
    .for('update');
  if (!account || account.revokedAt || account.scheduledErasureAt) return null;
  const tokens = resolveAccountTokens(account);
  return tokens.accessToken || tokens.refreshToken ? account : null;
}

/** Continue the established erasure/publication order: user -> account -> activity. */
export async function lockPlaceSource(
  tx: PlaceTransaction,
  actor: Actor,
  activityId: string,
): Promise<{ sourceVersion: string } | null> {
  if (!(await lockPlaceAccount(tx, actor))) return null;
  const [row] = await tx
    .select({
      sourceVersion: sql<string>`md5(activity_stream_source(${activities})::text)`,
    })
    .from(activities)
    .where(
      and(
        eq(activities.id, sql`${activityId}::bigint`),
        eq(activities.athlete, actor.athleteId),
      ),
    )
    .for('update');
  return row ?? null;
}
