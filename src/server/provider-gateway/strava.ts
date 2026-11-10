import 'server-only';

import { AccountCredentialsUnavailableError } from '~/server/application/account-credentials';
import { getAccountInternal } from '~/server/db/internal';
import {
  StravaApiError,
  StravaClient,
  isStravaActivityNotFoundError,
  isStravaActivityPermissionError,
} from '~/server/strava/client';
import { StravaBudgetExceededError } from '~/server/strava/request-budget';

import type { GatewayFailure, GatewayOperation } from './contract';

type Reads = Pick<
  StravaClient,
  'getActivity' | 'getActivityStreams' | 'getActivityPhotos' | 'getActivities'
>;

/**
 * One provider read for an owner. The account's token is refreshed when it
 * has expired (and the new one stored), and every request, the refresh
 * included, reserves from the shared budget that all accounts use.
 */
export async function readFromStrava(
  owner: { userId: string; athleteId: number },
  operation: GatewayOperation,
  deps: {
    resolveAccount?: typeof getAccountInternal;
    createClient?: (accessToken: string) => Reads;
  } = {},
): Promise<unknown> {
  const account = await (deps.resolveAccount ?? getAccountInternal)({
    userId: owner.userId,
  });
  if (
    !account?.access_token ||
    account.revokedAt ||
    account.scheduledErasureAt ||
    account.accountId !== String(owner.athleteId)
  )
    throw new AccountCredentialsUnavailableError('missing_credentials');
  const client = (
    deps.createClient ??
    ((token: string) => StravaClient.withAccessToken(token))
  )(account.access_token);
  switch (operation.kind) {
    case 'activity':
      return client.getActivity(Number(operation.id));
    case 'streams':
      return client.getActivityStreams(operation.id);
    case 'photos':
      return client.getActivityPhotos(Number(operation.id));
    case 'activities':
      return client.getActivities({
        page: operation.page,
        per_page: operation.perPage,
        before: operation.before,
        after: operation.after,
      });
  }
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
    return { kind: 'credentials_rejected' };
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
