import 'server-only';

import { and, eq, isNotNull, notExists, sql } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import { accounts, users, type User } from '~/server/db/schema';

type DrizzleDb = typeof defaultDb;

export type LegacyActivitySyncUser = Pick<
  User,
  'id' | 'athlete_id' | 'oldest_activity_reached'
>;

export interface LegacyActivitySyncRepository {
  listEligibleUsers(): Promise<LegacyActivitySyncUser[]>;
}

/**
 * Database boundary for the legacy bulk activity-sync cron.
 *
 * Revoked Strava accounts are filtered in the query itself, before the
 * caller can resolve or refresh credentials. Keeping this query behind a
 * repository also lets the PostgreSQL CI proof exercise the exact query
 * used by production.
 */
export function createLegacyActivitySyncRepository(
  database: DrizzleDb = defaultDb,
): LegacyActivitySyncRepository {
  return {
    async listEligibleUsers() {
      return database
        .select({
          id: users.id,
          athlete_id: users.athlete_id,
          oldest_activity_reached: users.oldest_activity_reached,
        })
        .from(users)
        .where(
          and(
            isNotNull(users.athlete_id),
            notExists(
              database
                .select({ one: sql`1` })
                .from(accounts)
                .where(
                  and(
                    eq(accounts.userId, users.id),
                    eq(accounts.providerId, 'strava'),
                    isNotNull(accounts.revokedAt),
                  ),
                ),
            ),
          ),
        );
    },
  };
}

export const legacyActivitySyncRepository =
  createLegacyActivitySyncRepository();
