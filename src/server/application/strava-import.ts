import 'server-only';
import type { Actor } from '~/server/auth/actor';
import { stravaAccessEnabled } from '~/server/config/external-effects';
import { evaluateRateLimit } from '~/server/http/rate-limit';
import { rateLimitRepository } from '~/server/repositories/rate-limit';
import {
  stravaImportRepository,
  type ImportClaim,
  type StravaImportRepository,
} from '~/server/repositories/strava-import';
import { ingestionRepository } from '~/server/repositories/ingestion';
import type { ActivityImportProgress } from '~/server/strava/activity-import-policy';
import {
  fetchManualActivityBatchForActor,
  type SignupWarmupDeps,
} from './signup-warmup';

export class StravaImportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function startStravaImport(
  actor: Actor,
  repository: StravaImportRepository = stravaImportRepository,
  enabled = stravaAccessEnabled(),
) {
  if (!enabled)
    throw new StravaImportError(
      403,
      'external_effects_disabled',
      'Fetching from Strava is unavailable in this environment.',
    );
  const started = await repository.start(actor);
  if (!started)
    throw new StravaImportError(
      409,
      'strava_not_connected',
      'Reconnect Strava from Account to fetch activities.',
    );
  return started;
}

export async function runStravaImport(
  claim: ImportClaim,
  {
    repository = stravaImportRepository,
    rateLimits = rateLimitRepository,
    batch = fetchManualActivityBatchForActor,
    batchDeps = {},
    clock = Date.now,
    timeMs = 35_000,
  }: {
    repository?: StravaImportRepository;
    rateLimits?: Pick<typeof rateLimitRepository, 'incrementAndGet'>;
    batch?: typeof fetchManualActivityBatchForActor;
    batchDeps?: SignupWarmupDeps;
    clock?: () => number;
    timeMs?: number;
  } = {},
) {
  let progress: ActivityImportProgress = {
    summaries: 0,
    details: 0,
    photos: 0,
    requests: 0,
    cursor: claim.cursor,
  };
  let retrySeconds = 15 * 60;
  try {
    if (!(await repository.isCurrent(claim))) return;
    const admission = await evaluateRateLimit(
      rateLimits,
      'signup-warmup:global',
      { limit: 1, windowMs: 60_000 },
      new Date(clock()),
    );
    if (!admission.allowed) {
      await repository.save(claim, progress, {
        status: 'deferred',
        reason: 'busy',
      });
      return;
    }
    const result = await batch(
      claim.actor,
      {
        cursor: claim.cursor,
        isCurrent: () => repository.isCurrent(claim),
        replaceCredentials: (previousToken, tokens) =>
          repository.replaceCredentials(claim, previousToken, tokens),
        onRateLimited: (seconds) => {
          retrySeconds = seconds;
        },
        onProgress: async (next) => {
          progress = next;
          await repository.save(claim, next);
        },
      },
      {
        ...batchDeps,
        timeMs,
        ingestion: {
          ...(batchDeps.ingestion ?? ingestionRepository),
          findDetailCandidates: (athleteId) =>
            repository.candidates(athleteId, 5),
        },
      },
    );
    progress = {
      ...progress,
      summaries: result.summaries,
      details: result.details,
      requests: result.requests,
    };
    const reason = result.stopReason;
    await repository.save(claim, progress, {
      status:
        reason === 'complete'
          ? 'succeeded'
          : reason === 'account_unavailable'
            ? 'blocked'
            : reason === 'detail_failed'
              ? 'failed'
              : 'deferred',
      reason,
      ...(reason === 'rate_limit'
        ? { retryAt: new Date(clock() + Math.max(5 * 60, retrySeconds) * 1000) }
        : {}),
    });
  } catch (error) {
    await repository.save(claim, progress, {
      status: 'failed',
      reason: 'internal_error',
    });
    throw error;
  }
}
