import 'server-only';

import {
  type ResolvedAccountTokens,
  accountTokenColumnsNeedNormalization,
  resolveAccountTokens,
} from '~/server/db/account-token-normalization';
import type { Account } from '~/server/db/schema';
import type {
  AccountIdentity,
  AccountsRepository,
} from '~/server/repositories/accounts';
import type { StravaTokens } from '~/server/strava/client';

export class AccountCredentialsUnavailableError extends Error {
  constructor(
    public readonly reason:
      'missing_account' | 'missing_credentials' | 'revoked' | 'changed',
  ) {
    super('The connected Strava account is unavailable.');
    this.name = 'AccountCredentialsUnavailableError';
  }
}

export class AccountPersistenceError extends Error {
  constructor(
    public readonly upstreamSucceeded: boolean,
    cause: unknown,
  ) {
    super('Account credentials could not be saved locally.', { cause });
    this.name = 'AccountPersistenceError';
  }
}

export type AccountCredentialsDependencies = {
  repository: AccountsRepository;
  clock: () => number;
  createClient: (
    refreshToken: string,
    persist: (tokens: StravaTokens) => Promise<void>,
  ) => { refreshAccessToken(): Promise<StravaTokens> };
};

/** Explicit identity only. No request globals, logging of credentials or error flattening. */
export function createAccountCredentialsService({
  repository,
  clock,
  createClient,
}: AccountCredentialsDependencies) {
  async function save(
    operation: () => Promise<Account | null>,
    upstreamSucceeded = false,
  ): Promise<Account> {
    let saved: Account | null;
    try {
      saved = await operation();
    } catch (cause) {
      throw new AccountPersistenceError(upstreamSucceeded, cause);
    }
    if (!saved) throw new AccountCredentialsUnavailableError('changed');
    return saved;
  }

  async function lookupAccount(identity: AccountIdentity) {
    if (!identity.userId && !identity.accountId)
      throw new TypeError('Explicit account identity required');
    const account = await repository.findStravaAccount(identity);
    if (
      account &&
      (account.providerId !== 'strava' ||
        (identity.userId && account.userId !== identity.userId) ||
        (identity.accountId && account.accountId !== identity.accountId))
    ) {
      throw new AccountCredentialsUnavailableError('changed');
    }
    return account;
  }

  async function reconnectAccount(account: Account): Promise<Account> {
    if (!account.revokedAt && !account.scheduledErasureAt) return account;
    if (!resolveAccountTokens(account).accessToken)
      throw new AccountCredentialsUnavailableError('revoked');
    return save(() => repository.reconnect(account));
  }

  async function normalizeCredentials(account: Account): Promise<Account> {
    if (account.revokedAt || account.scheduledErasureAt)
      throw new AccountCredentialsUnavailableError('revoked');
    const tokens = resolveAccountTokens(account);
    if (!accountTokenColumnsNeedNormalization(account, tokens)) return account;
    return save(() => repository.normalizeCredentials(account, tokens));
  }

  async function refreshCredentials(account: Account): Promise<Account> {
    if (account.revokedAt || account.scheduledErasureAt)
      throw new AccountCredentialsUnavailableError('revoked');
    const refreshToken = resolveAccountTokens(account).refreshToken;
    if (!refreshToken)
      throw new AccountCredentialsUnavailableError('missing_credentials');
    let saved: Account | undefined;
    const client = createClient(refreshToken, async (tokens) => {
      const refreshed: ResolvedAccountTokens = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresAtSeconds: tokens.expires_at,
        expiresAtDate: new Date(tokens.expires_at * 1000),
      };
      // The callback commits before StravaClient accepts the new credentials.
      saved = await save(
        () => repository.replaceCredentials(account, refreshed),
        true,
      );
    });
    await client.refreshAccessToken(); // Preserve typed upstream errors and retry metadata unchanged.
    if (!saved)
      throw new AccountPersistenceError(
        true,
        new Error('Refresh completed without persistence'),
      );
    return saved;
  }

  async function getAccountWithCredentials(
    input: AccountIdentity & { forceRefresh?: boolean },
  ): Promise<Account | null> {
    let account = await lookupAccount(input);
    if (!account) {
      if (input.accountId) return null; // Unknown webhook athlete remains a normal absence.
      throw new AccountCredentialsUnavailableError('missing_account');
    }
    account = await reconnectAccount(account);
    account = await normalizeCredentials(account);
    const tokens = resolveAccountTokens(account);
    const expired =
      input.forceRefresh === true ||
      !tokens.accessToken ||
      tokens.expiresAtSeconds == null ||
      Math.floor(clock() / 1000) >= tokens.expiresAtSeconds;
    return expired ? refreshCredentials(account) : account;
  }

  return {
    lookupAccount,
    reconnectAccount,
    normalizeCredentials,
    refreshCredentials,
    getAccountWithCredentials,
  };
}
