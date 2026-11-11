import 'server-only';

import type { Actor } from '~/server/auth/actor';
import type { getAccountInternal } from '~/server/auth/users';
import { EXTERNAL_EFFECTS_DISABLED_MESSAGE } from '~/server/config/external-effects';
import {
  StravaApiError,
  isStravaActivityNotFoundError,
} from '~/server/strava/client';
import { StravaBudgetExceededError } from '~/server/strava/request-budget';
import { StravaPersistenceError } from '~/server/strava/service';

import {
  AccountCredentialsUnavailableError,
  AccountPersistenceError,
} from './account-credentials';

export type ActivityMutationErrorCode =
  | 'activity_unavailable'
  | 'strava_not_connected'
  | 'external_effects_disabled'
  | 'rate_limited'
  | 'local_state_conflict'
  | 'upstream_rejected'
  | 'upstream_unavailable'
  | 'local_persistence_failed';

/** A failed change to an activity, as the web and v1 boundaries report it. */
export class ActivityMutationError extends Error {
  constructor(
    public readonly code: ActivityMutationErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    public readonly retryAfterSeconds?: number,
    public readonly details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ActivityMutationError';
  }
}

type AccountResolver = typeof getAccountInternal;

export function mutationFailure(error: unknown): ActivityMutationError {
  if (error instanceof ActivityMutationError) return error;
  if (error instanceof AccountCredentialsUnavailableError)
    return new ActivityMutationError(
      error.reason === 'changed'
        ? 'local_state_conflict'
        : 'strava_not_connected',
      error.message,
      409,
      error.reason === 'changed',
      undefined,
      undefined,
      { cause: error },
    );
  if (
    error instanceof StravaPersistenceError ||
    error instanceof AccountPersistenceError
  )
    return new ActivityMutationError(
      'local_persistence_failed',
      error.upstreamSucceeded
        ? 'Strava completed the request, but the result was not saved locally.'
        : 'The upstream result could not be reconciled locally.',
      503,
      true,
      undefined,
      {
        upstreamSucceeded: error.upstreamSucceeded,
        recovery: 'reconcile_or_retry_explicitly',
      },
      { cause: error },
    );
  if (error instanceof StravaBudgetExceededError)
    return new ActivityMutationError(
      'rate_limited',
      'The shared Strava request budget is exhausted.',
      429,
      true,
      error.retryAfterSeconds,
      undefined,
      { cause: error },
    );
  if (error instanceof StravaApiError) {
    if (isStravaActivityNotFoundError(error))
      return new ActivityMutationError(
        'activity_unavailable',
        'The activity is unavailable.',
        404,
        false,
        undefined,
        undefined,
        { cause: error },
      );
    if (error.status === 429)
      return new ActivityMutationError(
        'rate_limited',
        'Strava rate-limited the request.',
        429,
        true,
        error.retryAfterSeconds ?? 60,
        undefined,
        { cause: error },
      );
    if (error.status === 401 || error.status === 403)
      return new ActivityMutationError(
        'strava_not_connected',
        'The connected Strava account is unavailable.',
        409,
        false,
        undefined,
        undefined,
        { cause: error },
      );
    if (error.status >= 500)
      return new ActivityMutationError(
        'upstream_unavailable',
        'Strava could not complete the request.',
        503,
        true,
        error.retryAfterSeconds ?? 60,
        undefined,
        { cause: error },
      );
    return new ActivityMutationError(
      'upstream_rejected',
      'Strava rejected the request.',
      502,
      false,
      undefined,
      undefined,
      { cause: error },
    );
  }
  if (
    error instanceof Error &&
    error.message === EXTERNAL_EFFECTS_DISABLED_MESSAGE
  )
    return new ActivityMutationError(
      'external_effects_disabled',
      'Strava access is disabled in this environment.',
      503,
      false,
      undefined,
      undefined,
      { cause: error },
    );
  return new ActivityMutationError(
    'upstream_unavailable',
    'Strava could not complete the request.',
    503,
    true,
    60,
    undefined,
    { cause: error },
  );
}

export async function resolveConnectedAccount(
  actor: Actor,
  resolveAccount: AccountResolver,
) {
  try {
    const account = await resolveAccount({ userId: actor.userId });
    if (
      !account?.access_token ||
      account.revokedAt ||
      account.scheduledErasureAt ||
      account.accountId !== String(actor.athleteId)
    ) {
      throw new AccountCredentialsUnavailableError('missing_credentials');
    }
    return { ...account, access_token: account.access_token };
  } catch (error) {
    throw mutationFailure(error);
  }
}
