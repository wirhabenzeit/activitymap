import 'server-only';

import { getAccountInternal } from '~/server/db/internal';
import { logger } from '~/server/logging/logger';
import {
  summaryReconciliationRepository as defaultRepository,
  type SummaryReconciliationClaim,
  type SummaryReconciliationRepository,
} from '~/server/repositories/summary-reconciliation';
import { StravaApiError, StravaClient } from '~/server/strava/client';
import type { StravaActivity } from '~/server/strava/types';

export const SUMMARY_RECONCILIATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const SUMMARY_RECONCILIATION_LEASE_MS = 10 * 60 * 1000;
export const SUMMARY_RECONCILIATION_PAGE_SIZE = 200;
export const DEFAULT_RECONCILIATION_BATCH_SIZE = 5;
export const MAX_RECONCILIATION_BATCH_SIZE = 20;
export const DEFAULT_PAGES_PER_ATHLETE = 1;
export const DEFAULT_CONFIRMATIONS_PER_ATHLETE = 20;

export interface SummaryReconciliationSource {
  listPage(input: {
    before: number;
    page: number;
    perPage: number;
  }): Promise<StravaActivity[]>;
  getActivity(activityId: number): Promise<StravaActivity>;
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
};

type AccountResolver = typeof getAccountInternal;

function productionSource(accessToken: string): SummaryReconciliationSource {
  const client = StravaClient.withAccessToken(accessToken);
  return {
    listPage: ({ before, page, perPage }) =>
      client.getActivities({ before, page, per_page: perPage }),
    getActivity: (activityId) => client.getActivity(activityId),
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof StravaApiError && error.status === 404;
}

export async function reconcileStravaSummaries({
  batchSize = DEFAULT_RECONCILIATION_BATCH_SIZE,
  pagesPerAthlete = DEFAULT_PAGES_PER_ATHLETE,
  confirmationsPerAthlete = DEFAULT_CONFIRMATIONS_PER_ATHLETE,
  pageSize = SUMMARY_RECONCILIATION_PAGE_SIZE,
  now = new Date(),
  repository = defaultRepository,
  resolveAccount = getAccountInternal,
  createSource = productionSource,
}: {
  batchSize?: number;
  pagesPerAthlete?: number;
  confirmationsPerAthlete?: number;
  pageSize?: number;
  now?: Date;
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
  for (const [name, value] of [
    ['pagesPerAthlete', pagesPerAthlete],
    ['confirmationsPerAthlete', confirmationsPerAthlete],
    ['pageSize', pageSize],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer`);
    }
  }

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
  };

  // Sequential by design: Strava's API limits are global to the application,
  // and each page can create hundreds of transactional change-feed writes.
  for (const candidate of candidates) {
    let claim: SummaryReconciliationClaim | null = null;
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

      const account = await resolveAccount({
        accountId: candidate.athleteId.toString(),
      });
      const accessToken = account?.accessToken ?? account?.access_token;
      if (!accessToken || account?.revokedAt) {
        throw new Error('Authorized Strava credential is unavailable');
      }
      const source = createSource(accessToken);

      for (
        let pageBudget = 0;
        claim.phase === 'scanning' && pageBudget < pagesPerAthlete;
        pageBudget += 1
      ) {
        const summaries = await source.listPage({
          before: claim.scanBefore,
          page: claim.nextPage,
          perPage: pageSize,
        });
        if (summaries.length > pageSize) {
          throw new Error('Strava returned more summaries than requested');
        }
        const terminal = summaries.length < pageSize;
        claim = await repository.applySummaryPage(claim, summaries, terminal);
        result.pages += 1;
        result.summaries += summaries.length;
      }

      if (claim.phase === 'confirming') {
        const missingCandidates = await repository.listMissingCandidates(
          claim,
          confirmationsPerAthlete,
        );
        for (const activityId of missingCandidates) {
          try {
            const detail = await source.getActivity(activityId);
            claim = await repository.confirmPresent(claim, detail, now);
            result.confirmedPresent += 1;
          } catch (error) {
            if (!isNotFound(error)) throw error;
            claim = await repository.confirmMissing(claim, activityId, now);
            result.deleted += 1;
          }
        }

        const stillMissing = await repository.listMissingCandidates(claim, 1);
        if (stillMissing.length === 0) {
          completed = await repository.complete(claim);
          if (completed) result.completed += 1;
        }
      }

      if (!completed) {
        await repository.release(claim, now);
        result.partial += 1;
      }
    } catch (error) {
      result.failed += 1;
      if (claim) {
        try {
          await repository.release(claim, now);
        } catch {
          // The lease will expire and become reclaimable even if releasing it
          // fails during the same database outage.
        }
      }
      logger.error('[Summary reconciliation] One athlete failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  logger.info('[Summary reconciliation] Cycle complete', result);
  return result;
}
