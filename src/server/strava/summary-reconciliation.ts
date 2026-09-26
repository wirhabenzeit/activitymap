import 'server-only';
import { StravaBudgetExceededError, STRAVA_RATE_LIMIT_15_MINUTE_RESERVE, STRAVA_RATE_LIMIT_DAILY_RESERVE } from './request-budget';
export { STRAVA_RATE_LIMIT_15_MINUTE_RESERVE, STRAVA_RATE_LIMIT_DAILY_RESERVE } from './request-budget';

import { getAccountInternal } from '~/server/db/internal';
import { logger } from '~/server/logging/logger';
import {
  summaryReconciliationRepository as defaultRepository,
  type SummaryReconciliationClaim,
  type SummaryReconciliationRepository,
} from '~/server/repositories/summary-reconciliation';
import {
  StravaApiError,
  StravaClient,
  type StravaRateLimitUsage,
} from '~/server/strava/client';
import type { StravaActivity } from '~/server/strava/types';

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Strava data must be revalidated within seven days. This server-side scan is
 * what enforces it (docs/strava-data-policy.md); clients just mirror the server.
 */
export const STRAVA_FRESHNESS_LIMIT_MS = 7 * DAY_MS;
/**
 * Start a new scan a day before the limit: a scan spans several hourly runs
 * (3 pages of 200 summaries each), so it must finish inside the limit.
 */
export const SUMMARY_RECONCILIATION_INTERVAL_MS = 6 * DAY_MS;
export const SUMMARY_RECONCILIATION_LEASE_MS = 10 * 60 * 1000;
export const SUMMARY_RECONCILIATION_PAGE_SIZE = 200;
export const DEFAULT_RECONCILIATION_BATCH_SIZE = 1;
export const MAX_RECONCILIATION_BATCH_SIZE = 20;
export const DEFAULT_PAGES_PER_ATHLETE = 3;
export const MAX_PAGES_PER_ATHLETE = 5;
export const DEFAULT_CONFIRMATIONS_PER_ATHLETE = 20;
export const SUMMARY_RECONCILIATION_TIME_BUDGET_MS = 45_000;

export interface SummaryReconciliationSource {
  listPage(input: {
    before: number;
    page: number;
    perPage: number;
  }): Promise<StravaActivity[]>;
  getActivity(activityId: number): Promise<StravaActivity>;
  getRateLimitUsage?(): StravaRateLimitUsage | null;
}

export type SummaryReconciliationRunResult = {
  candidates: number;
  claimed: number;
  pages: number;
  summaries: number;
  confirmedPresent: number;
  deleted: number;
  completed: number;
  partial: number;
  failed: number;
  stoppedForTimeBudget: number;
  stoppedForRateLimit: number;
  /** Eligible athletes whose data is older than the freshness limit. */
  overdue: number;
  elapsedMs: number;
};

type AccountResolver = typeof getAccountInternal;

function productionSource(accessToken: string): SummaryReconciliationSource {
  let rateLimitUsage: StravaRateLimitUsage | null = null;
  const client = StravaClient.withAccessToken(accessToken, {
    onRateLimit: (usage) => {
      rateLimitUsage = usage;
    },
  });
  return {
    listPage: ({ before, page, perPage }) =>
      client.getActivities({ before, page, per_page: perPage }),
    getActivity: (activityId) => client.getActivity(activityId),
    getRateLimitUsage: () => rateLimitUsage,
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof StravaApiError && error.status === 404;
}

function isRateLimited(error: unknown): boolean {
  return error instanceof StravaBudgetExceededError || (error instanceof StravaApiError && error.status === 429);
}

export function hasInsufficientStravaRateLimitHeadroom(
  usage: StravaRateLimitUsage | null | undefined,
): boolean {
  if (!usage) return false;
  return [usage.overall, usage.read]
    .filter((window) => window !== undefined)
    .some(
      (window) =>
        window.limit15Minutes - window.usage15Minutes <=
          STRAVA_RATE_LIMIT_15_MINUTE_RESERVE ||
        window.limitDaily - window.usageDaily <=
          STRAVA_RATE_LIMIT_DAILY_RESERVE,
    );
}

export async function reconcileStravaSummaries({
  batchSize = DEFAULT_RECONCILIATION_BATCH_SIZE,
  pagesPerAthlete = DEFAULT_PAGES_PER_ATHLETE,
  confirmationsPerAthlete = DEFAULT_CONFIRMATIONS_PER_ATHLETE,
  pageSize = SUMMARY_RECONCILIATION_PAGE_SIZE,
  timeBudgetMs = SUMMARY_RECONCILIATION_TIME_BUDGET_MS,
  now = new Date(),
  clock = Date.now,
  repository = defaultRepository,
  resolveAccount = getAccountInternal,
  createSource = productionSource,
}: {
  batchSize?: number;
  pagesPerAthlete?: number;
  confirmationsPerAthlete?: number;
  pageSize?: number;
  timeBudgetMs?: number;
  now?: Date;
  clock?: () => number;
  repository?: SummaryReconciliationRepository;
  resolveAccount?: AccountResolver;
  createSource?: (accessToken: string) => SummaryReconciliationSource;
} = {}): Promise<SummaryReconciliationRunResult> {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_RECONCILIATION_BATCH_SIZE
  ) {
    throw new RangeError(
      `batchSize must be an integer between 1 and ${MAX_RECONCILIATION_BATCH_SIZE}`,
    );
  }
  if (
    !Number.isInteger(pagesPerAthlete) ||
    pagesPerAthlete < 1 ||
    pagesPerAthlete > MAX_PAGES_PER_ATHLETE
  ) {
    throw new RangeError(
      `pagesPerAthlete must be an integer between 1 and ${MAX_PAGES_PER_ATHLETE}`,
    );
  }
  for (const [name, value] of [
    ['confirmationsPerAthlete', confirmationsPerAthlete],
    ['pageSize', pageSize],
    ['timeBudgetMs', timeBudgetMs],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer`);
    }
  }

  const startedAtMs = clock();
  const elapsedMs = () => Math.max(0, clock() - startedAtMs);
  const dueBefore = new Date(now.getTime() - SUMMARY_RECONCILIATION_INTERVAL_MS);
  const candidates = await repository.listDue(batchSize, dueBefore, now);
  const result: SummaryReconciliationRunResult = {
    candidates: candidates.length,
    claimed: 0,
    pages: 0,
    summaries: 0,
    confirmedPresent: 0,
    deleted: 0,
    completed: 0,
    partial: 0,
    failed: 0,
    stoppedForTimeBudget: 0,
    stoppedForRateLimit: 0,
    overdue: 0,
    elapsedMs: 0,
  };
  logger.info('[Summary reconciliation] Cycle started', {
    candidates: candidates.length,
    batchSize,
    pagesPerAthlete,
    confirmationsPerAthlete,
    pageSize,
    timeBudgetMs,
  });

  // Sequential by design: Strava's API limits are global to the application,
  // and each page can create hundreds of transactional change-feed writes.
  let stopReason: 'time_budget' | 'rate_limit' | null = null;
  for (const candidate of candidates) {
    if (elapsedMs() >= timeBudgetMs) {
      stopReason = 'time_budget';
      break;
    }
    let claim: SummaryReconciliationClaim | null = null;
    let source: SummaryReconciliationSource | null = null;
    let completed = false;
    try {
      claim = await repository.claim(
        candidate,
        dueBefore,
        now,
        SUMMARY_RECONCILIATION_LEASE_MS,
      );
      if (!claim) continue;
      result.claimed += 1;
      logger.info('[Summary reconciliation] Candidate claimed', {
        phase: claim.phase,
        nextPage: claim.nextPage,
      });

      const account = await resolveAccount({
        accountId: candidate.athleteId.toString(),
      });
      const accessToken = account?.accessToken ?? account?.access_token;
      if (!accessToken || account?.revokedAt) {
        throw new Error('Authorized Strava credential is unavailable');
      }
      source = createSource(accessToken);

      for (
        let pageBudget = 0;
        claim.phase === 'scanning' && pageBudget < pagesPerAthlete;
        pageBudget += 1
      ) {
        if (elapsedMs() >= timeBudgetMs) {
          stopReason = 'time_budget';
          break;
        }
        if (
          hasInsufficientStravaRateLimitHeadroom(
            source.getRateLimitUsage?.(),
          )
        ) {
          stopReason = 'rate_limit';
          break;
        }
        const summaries = await source.listPage({
          before: claim.scanBefore,
          page: claim.nextPage,
          perPage: pageSize,
        });
        if (summaries.length > pageSize) {
          throw new Error('Strava returned more summaries than requested');
        }
        // Strava documents that a non-final page can contain fewer results
        // than requested, so only an empty page proves the scan is complete.
        const terminal = summaries.length === 0;
        claim = await repository.applySummaryPage(claim, summaries, terminal);
        result.pages += 1;
        result.summaries += summaries.length;
        logger.info('[Summary reconciliation] Page checkpointed', {
          summaries: summaries.length,
          terminal,
          nextPhase: claim.phase,
          nextPage: claim.nextPage,
          elapsedMs: elapsedMs(),
          rateLimit: source.getRateLimitUsage?.() ?? null,
        });
      }

      if (!stopReason && claim.phase === 'confirming') {
        const missingCandidates = await repository.listMissingCandidates(
          claim,
          confirmationsPerAthlete,
        );
        for (const activityId of missingCandidates) {
          if (elapsedMs() >= timeBudgetMs) {
            stopReason = 'time_budget';
            break;
          }
          if (
            hasInsufficientStravaRateLimitHeadroom(
              source.getRateLimitUsage?.(),
            )
          ) {
            stopReason = 'rate_limit';
            break;
          }
          try {
            const detail = await source.getActivity(activityId);
            claim = await repository.confirmPresent(claim, detail, now);
            result.confirmedPresent += 1;
            logger.info('[Summary reconciliation] Candidate confirmed', {
              outcome: 'present',
              elapsedMs: elapsedMs(),
              rateLimit: source.getRateLimitUsage?.() ?? null,
            });
          } catch (error) {
            if (!isNotFound(error)) throw error;
            claim = await repository.confirmMissing(claim, activityId, now);
            result.deleted += 1;
            logger.info('[Summary reconciliation] Candidate confirmed', {
              outcome: 'missing',
              elapsedMs: elapsedMs(),
              rateLimit: source.getRateLimitUsage?.() ?? null,
            });
          }
        }

        if (!stopReason) {
          const stillMissing = await repository.listMissingCandidates(claim, 1);
          if (stillMissing.length === 0) {
            completed = await repository.complete(claim);
            if (completed) result.completed += 1;
          }
        }
      }

      if (!completed) {
        await repository.release(claim, now);
        result.partial += 1;
      }
      if (
        !stopReason &&
        hasInsufficientStravaRateLimitHeadroom(source.getRateLimitUsage?.())
      ) {
        stopReason = 'rate_limit';
      }
    } catch (error) {
      if (claim) {
        try {
          await repository.release(claim, now);
        } catch {
          // The lease will expire and become reclaimable even if releasing it
          // fails during the same database outage.
        }
      }
      if (isRateLimited(error)) {
        result.partial += 1;
        stopReason = 'rate_limit';
        logger.warn('[Summary reconciliation] Strava rate limit reached', {
          elapsedMs: elapsedMs(),
          rateLimit: source?.getRateLimitUsage?.() ?? null,
        });
      } else {
        result.failed += 1;
      }
      if (isRateLimited(error)) break;
      logger.error('[Summary reconciliation] One athlete failed', {
        // The logger redacts credentials and personal data, while retaining
        // the message/stack needed to diagnose production adapter failures.
        error,
      });
    }
    if (stopReason) break;
  }

  result.stoppedForTimeBudget = stopReason === 'time_budget' ? 1 : 0;
  result.stoppedForRateLimit = stopReason === 'rate_limit' ? 1 : 0;
  // The freshness guarantee depends on this job keeping up; surface any
  // athlete that has slipped past the limit so a stalled cron is noticed.
  result.overdue = await repository.countOverdue(
    new Date(now.getTime() - STRAVA_FRESHNESS_LIMIT_MS),
  );
  if (result.overdue > 0) {
    logger.warn('[Summary reconciliation] Athletes past the freshness limit', {
      overdue: result.overdue,
    });
  }
  result.elapsedMs = elapsedMs();
  logger.info('[Summary reconciliation] Cycle complete', result);
  return result;
}
