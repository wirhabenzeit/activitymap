import type { Account } from './schema';

export type ResolvedAccountTokens = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAtSeconds: number | null;
  expiresAtDate: Date | null;
};

type AccountTokenColumns = Pick<
  Account,
  | 'access_token'
  | 'accessToken'
  | 'refresh_token'
  | 'refreshToken'
  | 'expires_at'
  | 'expiresAt'
  | 'accessTokenExpiresAt'
>;

const datesEqual = (left: Date | null, right: Date | null) =>
  left?.getTime() === right?.getTime();

/**
 * Better Auth owns OAuth sign-in and reauthorization, so its current column
 * names are authoritative. Legacy columns remain a fallback during the
 * migration window for accounts created before Better Auth was introduced.
 */
export const resolveAccountTokens = (
  account: AccountTokenColumns,
): ResolvedAccountTokens => {
  const expiresAtDate =
    account.accessTokenExpiresAt ??
    account.expiresAt ??
    (account.expires_at != null ? new Date(account.expires_at * 1000) : null);

  return {
    accessToken: account.accessToken ?? account.access_token ?? null,
    refreshToken: account.refreshToken ?? account.refresh_token ?? null,
    expiresAtSeconds: expiresAtDate
      ? Math.floor(expiresAtDate.getTime() / 1000)
      : null,
    expiresAtDate,
  };
};

export const buildAccountTokenColumnUpdate = (
  tokens: ResolvedAccountTokens,
): AccountTokenColumns => ({
  access_token: tokens.accessToken,
  accessToken: tokens.accessToken,
  refresh_token: tokens.refreshToken,
  refreshToken: tokens.refreshToken,
  expires_at: tokens.expiresAtSeconds,
  expiresAt: tokens.expiresAtDate,
  accessTokenExpiresAt: tokens.expiresAtDate,
});

export const accountTokenColumnsNeedNormalization = (
  account: AccountTokenColumns,
  tokens: ResolvedAccountTokens,
) =>
  account.access_token !== tokens.accessToken ||
  account.accessToken !== tokens.accessToken ||
  account.refresh_token !== tokens.refreshToken ||
  account.refreshToken !== tokens.refreshToken ||
  account.expires_at !== tokens.expiresAtSeconds ||
  !datesEqual(account.expiresAt, tokens.expiresAtDate) ||
  !datesEqual(account.accessTokenExpiresAt, tokens.expiresAtDate);
