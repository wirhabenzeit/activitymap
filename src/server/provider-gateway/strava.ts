import 'server-only';

import { AccountCredentialsUnavailableError } from '~/server/application/account-credentials';
import { getAccountInternal } from '~/server/auth/users';
import {
  StravaApiError,
  StravaClient,
  isStravaActivityNotFoundError,
  isStravaActivityPermissionError,
} from '~/server/strava/client';
import { StravaBudgetExceededError } from '~/server/strava/request-budget';

import type { GatewayFailure, GatewayOperation } from './contract';

/** How often an account is read when its credentials change underneath. */
const CREDENTIAL_CONFLICT_ATTEMPTS = 3;

type Reads = Pick<
  StravaClient,
  'getActivity' | 'getActivityStreams' | 'getActivityPhotos' | 'getActivities'
>;

/**
 * One provider read for an owner. The account's token is refreshed when it
 * has expired (and the new one stored), and every request, the refresh
 * included, reserves from the shared budget that all accounts use.
 *
 * The provider can reject a token before its recorded expiry. That is not
 * the end of the connection while the refresh token still works: the token
 * is refreshed once through the account service, which stores it under the
 * same guards as any refresh, and the read is made once more. Only when that
 * refresh or the second read is rejected too does the error stand.
 */
export async function readFromStrava(
  owner: { userId: string; athleteId: number },
  operation: GatewayOperation,
  deps: {
    resolveAccount?: typeof getAccountInternal;
    createClient?: (accessToken: string) => Reads;
  } = {},
): Promise<unknown> {
  const resolve = deps.resolveAccount ?? getAccountInternal;
  const createClient =
    deps.createClient ??
    ((token: string) => StravaClient.withAccessToken(token));
  /** The owner's usable access token, refreshed first when asked to. */
  const accessToken = async (forceRefresh: boolean) => {
    // Resolving can refresh the token, and two requests can refresh at
    // once. The one that loses the stored-version check has not lost its
    // access: the other saved valid credentials, so read the account again.
    let account;
    for (let attempt = 1; ; attempt++) {
      try {
        account = await resolve({ userId: owner.userId, forceRefresh });
        break;
      } catch (error) {
        if (
          !(error instanceof AccountCredentialsUnavailableError) ||
          error.reason !== 'changed' ||
          attempt >= CREDENTIAL_CONFLICT_ATTEMPTS
        )
          throw error;
        // The other request refreshed already; its token is the new one.
        forceRefresh = false;
      }
    }
    if (
      !account?.access_token ||
      account.revokedAt ||
      account.scheduledErasureAt ||
      account.accountId !== String(owner.athleteId)
    )
      throw new AccountCredentialsUnavailableError('missing_credentials');
    return account.access_token;
  };
  const read = (token: string) => {
    const client = createClient(token);
    switch (operation.kind) {
      case 'activity':
        // IDs stay decimal strings: they can exceed the safe integer range.
        return client.getActivity(operation.id);
      case 'streams':
        return client.getActivityStreams(operation.id);
      case 'photos':
        return client.getActivityPhotos(operation.id);
      case 'activities':
        return client.getActivities({
          page: operation.page,
          per_page: operation.perPage,
          before: operation.before,
          after: operation.after,
        });
    }
  };
  try {
    return await read(await accessToken(false));
  } catch (error) {
    // A missing activity permission is a 401 as well, and no refresh fixes
    // that.
    if (
      !(error instanceof StravaApiError) ||
      error.status !== 401 ||
      isStravaActivityPermissionError(error)
    )
      throw error;
  }
  return read(await accessToken(true));
}

/** The typed failure for an error from `readFromStrava`, or null when it is
 * not one the caller can act on (a bug or an infrastructure fault). */
export function gatewayFailureFor(error: unknown): GatewayFailure | null {
  if (error instanceof StravaBudgetExceededError)
    return {
      kind: 'rate_limited',
      retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterSeconds)),
    };
  if (error instanceof AccountCredentialsUnavailableError)
    // `changed` means the stored credentials moved while they were being
    // read or refreshed, which says nothing about the owner's access.
    return error.reason === 'changed'
      ? { kind: 'upstream_error', status: null, retryable: true }
      : { kind: 'credentials_rejected' };
  // Before the status checks: the provider answers 401 for a missing
  // activity permission even when the token itself is valid.
  if (isStravaActivityPermissionError(error)) return { kind: 'forbidden' };
  if (isStravaActivityNotFoundError(error)) return { kind: 'not_found' };
  if (error instanceof StravaApiError) {
    if (error.status === 429)
      return {
        kind: 'rate_limited',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(error.retryAfterSeconds ?? 15 * 60),
        ),
      };
    if (error.status === 401) return { kind: 'credentials_rejected' };
    return {
      kind: 'upstream_error',
      status: error.status,
      // A 404 that is not the recognized missing-record answer does not
      // prove deletion, and other client errors will not change either.
      retryable: error.status >= 500,
    };
  }
  if (
    error instanceof TypeError ||
    (error instanceof Error &&
      ['AbortError', 'TimeoutError'].includes(error.name))
  )
    return { kind: 'upstream_error', status: null, retryable: true };
  return null;
}
