import 'server-only';

import { createHash } from 'node:crypto';

import type { ResolvedAccountTokens } from '~/server/auth/account-tokens';
import type { Account } from '~/server/records';

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
