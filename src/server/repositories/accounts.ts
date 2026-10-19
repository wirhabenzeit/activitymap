import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import {
  type ResolvedAccountTokens,
  buildAccountTokenColumnUpdate,
  resolveAccountTokens,
} from '~/server/db/account-token-normalization';
import { type Account, accounts, users } from '~/server/db/schema';

export type AccountIdentity =
  | { userId: string; accountId?: string }
  | { accountId: string; userId?: string };

/** Fingerprint both representations: native reauthorization must fence legacy work. */
export function accountCredentialVersion(account: Account): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        account.id,
        account.userId,
        account.providerId,
        account.accountId,
        account.accessToken,
        account.access_token,
        account.refreshToken,
        account.refresh_token,
        account.expires_at,
        account.expiresAt,
        account.accessTokenExpiresAt,
        account.refreshTokenExpiresAt,
        account.updatedAt,
        account.revokedAt,
        account.scheduledErasureAt,
      ]),
    )
    .digest('hex');
}

export interface AccountsRepository {
  /** Read only; explicit identity, always scoped to provider=strava. */
  findStravaAccount(identity: AccountIdentity): Promise<Account | null>;
  normalizeCredentials(
    expected: Account,
    tokens: ResolvedAccountTokens,
  ): Promise<Account | null>;
  reconnect(expected: Account): Promise<Account | null>;
  replaceCredentials(
    expected: Account,
    tokens: ResolvedAccountTokens,
  ): Promise<Account | null>;
}

type Database = typeof defaultDb;

export function createAccountsRepository(
  database: Database = defaultDb,
): AccountsRepository {
  type Update = Partial<typeof accounts.$inferInsert>;
  async function compareAndUpdate(
    expected: Account,
    change: (current: Account) => Update | null,
  ) {
    const athleteId = Number(expected.accountId);
    if (!Number.isSafeInteger(athleteId) || athleteId <= 0) return null;
    return database.transaction(async (tx) => {
      // Match erasure's user-before-account lock order. A deleted/recreated
      // account, revoked grant or newer authorization can never receive this write.
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(eq(users.id, expected.userId), eq(users.athlete_id, athleteId)),
        )
        .for('key share');
      if (!user) return null;
      const [current] = await tx
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.id, expected.id),
            eq(accounts.userId, expected.userId),
            eq(accounts.accountId, expected.accountId),
            eq(accounts.providerId, 'strava'),
          ),
        )
        .for('update');
      if (
        !current ||
        accountCredentialVersion(current) !== accountCredentialVersion(expected)
      )
        return null;
      const update = change(current);
      if (!update) return null;
      const [saved] = await tx
        .update(accounts)
        .set(update)
        .where(eq(accounts.id, current.id))
        .returning();
      return saved ?? null;
    });
  }
  return {
    async findStravaAccount(identity) {
      if (!identity.userId && !identity.accountId)
        throw new TypeError('Explicit account identity required');
      return (
        (await database.query.accounts.findFirst({
          where: and(
            eq(accounts.providerId, 'strava'),
            identity.userId ? eq(accounts.userId, identity.userId) : undefined,
            identity.accountId
              ? eq(accounts.accountId, identity.accountId)
              : undefined,
          ),
        })) ?? null
      );
    },
    normalizeCredentials(expected, tokens) {
      return compareAndUpdate(expected, (current) =>
        current.revokedAt || current.scheduledErasureAt
          ? null
          : buildAccountTokenColumnUpdate(tokens),
      );
    },
    reconnect(expected) {
      // Only OAuth writes a live token alongside a revocation marker. Never
      // infer reconnection from a refresh-token-only revoked account.
      return compareAndUpdate(expected, (current) =>
        (current.revokedAt || current.scheduledErasureAt) &&
        resolveAccountTokens(current).accessToken
          ? { revokedAt: null, scheduledErasureAt: null }
          : null,
      );
    },
    replaceCredentials(expected, tokens) {
      return compareAndUpdate(expected, (current) =>
        current.revokedAt || current.scheduledErasureAt
          ? null
          : buildAccountTokenColumnUpdate(tokens),
      );
    },
  };
}
