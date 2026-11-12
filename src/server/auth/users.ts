import 'server-only';

import { createAccountCredentialsService } from '~/server/application/account-credentials';
import type { User } from '~/server/records';
import type { AccountIdentity } from '~/server/repositories/accounts';
import { StravaClient } from '~/server/strava/client';

import { convexAuthRecords } from './convex-records';

/**
 * Users and their Strava accounts, for server code that acts without a
 * request: the records live in the sign-in store in Convex
 * (`./convex-records.ts`).
 */
const records = convexAuthRecords();

export class UserNotFoundError extends Error {
  constructor() {
    super('User not found');
    this.name = 'UserNotFoundError';
  }
}

export const getUserInternal = async (id: string) => {
  if (!id) throw new TypeError('Explicit user identity required');
  const user = await records.user(id);
  if (!user) throw new UserNotFoundError();
  return user;
};

export const findUserInternal = async (id: string): Promise<User | null> => {
  try {
    return await getUserInternal(id);
  } catch (error) {
    if (error instanceof UserNotFoundError) return null;
    throw error;
  }
};

export const updateUserInternal = (
  id: string,
  change: Partial<
    Pick<User, 'athlete_id' | 'writer' | 'writerEpoch' | 'convexEpoch'>
  >,
) => records.updateUser(id, change);

export const findStravaAccountInternal = (identity: AccountIdentity) =>
  records.accounts.findStravaAccount(identity);

export const setAccountScopeInternal = (accountId: string, scope: string) =>
  records.setAccountScope(accountId, scope);

const credentials = createAccountCredentialsService({
  repository: records.accounts,
  clock: Date.now,
  createClient: (refreshToken, persist) =>
    StravaClient.withRefreshToken(refreshToken, persist),
});

/** The account with an access token that is valid now, refreshed if needed. */
export const getAccountInternal = (
  identity: AccountIdentity & { forceRefresh?: boolean },
) => credentials.getAccountWithCredentials(identity);
