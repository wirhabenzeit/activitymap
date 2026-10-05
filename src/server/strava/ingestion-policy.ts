import { ZodError } from 'zod';
import { StravaApiError } from './client';
import { StravaBudgetExceededError } from './request-budget';
import type {
  IngestionOutcome,
  IngestionReason,
} from '~/contracts/v1/ingestion-status';

export {
  INGESTION_OUTCOMES,
  INGESTION_REASONS,
  type IngestionOutcome,
  type IngestionReason,
} from '~/contracts/v1/ingestion-status';

/**
 * Shared vocabulary for per-account ingestion outcomes (issue #296). Workers
 * record these; the status read model reports them. See
 * docs/ingestion-status.md for the product meaning of each value.
 */
export const INGESTION_PIPELINES = ['history', 'details'] as const;
export type IngestionPipeline = (typeof INGESTION_PIPELINES)[number];

export type IngestionOutcomeRecord = {
  outcome: IngestionOutcome;
  reason: IngestionReason | null;
  retryAt?: Date | null;
};

export const DETAIL_RETRY_HOUR_MS = 3_600_000;
export type DetailFailureCode = 'upstream_error' | 'invalid_response' | 'forbidden';

/** Same capped exponential backoff as historical stream backfill. */
export function detailRetryAt(now: Date, attempt: number): Date {
  return new Date(
    now.getTime() +
      Math.min(
        24 * DETAIL_RETRY_HOUR_MS,
        DETAIL_RETRY_HOUR_MS * 2 ** Math.min(10, Math.max(0, attempt - 1)),
      ),
  );
}

/**
 * Where a failed Strava call belongs. Rate limits and rejected credentials
 * affect the whole account (or application), so they must never back off or
 * blame an individual activity.
 */
export type IngestionFailure =
  | { scope: 'run'; outcome: 'deferred'; reason: 'rate_limited' }
  | {
      scope: 'account';
      outcome: 'blocked';
      reason: 'unauthorized' | 'credentials_unavailable';
    }
  | { scope: 'activity'; code: DetailFailureCode };

/** No usable, authorized Strava credential could be resolved for the account. */
export class CredentialUnavailableError extends Error {
  constructor() {
    super('Authorized Strava credential is unavailable');
    this.name = 'CredentialUnavailableError';
  }
}

export function classifyIngestionFailure(error: unknown): IngestionFailure {
  if (error instanceof CredentialUnavailableError)
    return {
      scope: 'account',
      outcome: 'blocked',
      reason: 'credentials_unavailable',
    };
  if (error instanceof StravaBudgetExceededError)
    return { scope: 'run', outcome: 'deferred', reason: 'rate_limited' };
  if (error instanceof StravaApiError) {
    if (error.status === 429)
      return { scope: 'run', outcome: 'deferred', reason: 'rate_limited' };
    if (error.status === 401)
      return { scope: 'account', outcome: 'blocked', reason: 'unauthorized' };
    if (error.status === 403) return { scope: 'activity', code: 'forbidden' };
  }
  if (error instanceof ZodError || error instanceof SyntaxError)
    return { scope: 'activity', code: 'invalid_response' };
  return { scope: 'activity', code: 'upstream_error' };
}

/**
 * Reason recorded when a whole step fails with `error`. Anything that is not
 * a Strava response or a network failure is reported as an internal error,
 * never blamed on Strava.
 */
export function failureReason(error: unknown): IngestionReason {
  const failure = classifyIngestionFailure(error);
  if (failure.scope !== 'activity') return failure.reason;
  if (failure.code === 'invalid_response') return 'invalid_response';
  return error instanceof StravaApiError || error instanceof TypeError
    ? 'upstream_error'
    : 'internal_error';
}

/** The outcome of a step that threw before committing anything. */
export function outcomeForError(error: unknown): IngestionOutcomeRecord {
  const failure = classifyIngestionFailure(error);
  return failure.scope === 'activity'
    ? { outcome: 'failed', reason: failureReason(error) }
    : { outcome: failure.outcome, reason: failure.reason };
}

/**
 * Scheduled ingestion jobs and how often each is expected to start. The
 * GitHub workflows in .github/workflows own the actual schedule; these only
 * decide when a missing heartbeat means the job has stalled.
 */
export const INGESTION_JOBS = {
  'sync-activities': { intervalMs: 12 * DETAIL_RETRY_HOUR_MS },
  'reconcile-strava-summaries': { intervalMs: DETAIL_RETRY_HOUR_MS },
  'backfill-activity-streams': { intervalMs: DETAIL_RETRY_HOUR_MS },
} as const;
export type IngestionJob = keyof typeof INGESTION_JOBS;

/** A run that started this long ago and never finished has crashed. */
export const INGESTION_JOB_MAX_RUN_MS = 5 * 60_000;
