import 'server-only';

import { eq } from 'drizzle-orm';

import { createAccountCredentialsService } from '~/server/application/account-credentials';
import { convexAuthRecords } from '~/server/auth/convex-records';
import { authStoreIsConvex } from '~/server/auth/store';
import {
  type AccountIdentity,
  createAccountsRepository,
} from '~/server/repositories/accounts';
import { StravaClient } from '~/server/strava/client';

import { db } from './index';
import { type User, accounts, users } from './schema';

/**
 * Users and linked provider accounts, wherever sign-in records live
 * (`~/server/auth/store.ts`): Postgres, or the sign-in store in Convex.
 * Everything outside the auth library reads and changes them through here.
 */
const records = authStoreIsConvex() ? convexAuthRecords() : null;
const accountsRepository = records?.accounts ?? createAccountsRepository();

/** Missing local user is distinct from an infrastructure/query failure. */
export class UserNotFoundError extends Error {
  constructor() {
    super('User not found');
    this.name = 'UserNotFoundError';
  }
}

/** Read only; transport adapters resolve optional request-global identity. */
export const getUserInternal = async (id: string) => {
  if (!id) throw new TypeError('Explicit user identity required');
  const user = records
    ? await records.user(id)
    : await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, id),
      });
  if (!user) throw new UserNotFoundError();
  return user;
};

/** The user, or null when there is none. */
export const findUserInternal = async (id: string): Promise<User | null> => {
  try {
    return await getUserInternal(id);
  } catch (error) {
    if (error instanceof UserNotFoundError) return null;
    throw error;
  }
};

/** Change routing or reconciliation fields of a user. */
export async function updateUserInternal(
  id: string,
  change: Partial<
    Pick<
      User,
      | 'athlete_id'
      | 'writer'
      | 'writerEpoch'
      | 'convexEpoch'
      | 'lastSummaryReconciledAt'
    >
  >,
) {
  if (records) return records.updateUser(id, change);
  const rows = await db
    .update(users)
    .set(change)
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** The user's linked Strava account as stored; no refresh, no repair. */
export const findStravaAccountInternal = (identity: AccountIdentity) =>
  accountsRepository.findStravaAccount(identity);

/** Record the scopes the person approved at sign-in. */
export async function setAccountScopeInternal(
  accountId: string,
  scope: string,
) {
  if (records) return records.setAccountScope(accountId, scope);
  await db.update(accounts).set({ scope }).where(eq(accounts.id, accountId));
}

const credentials = createAccountCredentialsService({
  repository: accountsRepository,
  clock: Date.now,
  createClient: (refreshToken, persist) =>
    StravaClient.withRefreshToken(refreshToken, persist),
});

/** Compatibility entry point. Lookup/normalization/reconnection/refresh are named operations. */
export const getAccountInternal = (
  identity: AccountIdentity & { forceRefresh?: boolean },
) => credentials.getAccountWithCredentials(identity);
