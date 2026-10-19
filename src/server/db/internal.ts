import 'server-only';

import { createAccountCredentialsService } from '~/server/application/account-credentials';
import {
  type AccountIdentity,
  createAccountsRepository,
} from '~/server/repositories/accounts';
import { StravaClient } from '~/server/strava/client';

import { db } from './index';

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
  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, id),
  });
  if (!user) throw new UserNotFoundError();
  return user;
};

const credentials = createAccountCredentialsService({
  repository: createAccountsRepository(),
  clock: Date.now,
  createClient: (refreshToken, persist) =>
    StravaClient.withRefreshToken(refreshToken, persist),
});

/** Compatibility entry point. Lookup/normalization/reconnection/refresh are named operations. */
export const getAccountInternal = (
  identity: AccountIdentity & { forceRefresh?: boolean },
) => credentials.getAccountWithCredentials(identity);
