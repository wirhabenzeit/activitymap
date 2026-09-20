import 'server-only';

import {
  erasureRepository as defaultRepository,
  type ErasureRepository,
} from '~/server/repositories/erasure';
import { logger } from '~/server/logging/logger';

export const DEFAULT_ERASURE_BATCH_SIZE = 25;
export const MAX_ERASURE_BATCH_SIZE = 100;

export type ErasureRunResult = {
  candidates: number;
  erased: number;
  cancelled: number;
  stale: number;
  failed: number;
};

export async function eraseDueRevokedAthletes({
  batchSize = DEFAULT_ERASURE_BATCH_SIZE,
  now = new Date(),
  repository = defaultRepository,
}: {
  batchSize?: number;
  now?: Date;
  repository?: ErasureRepository;
} = {}): Promise<ErasureRunResult> {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_ERASURE_BATCH_SIZE
  ) {
    throw new RangeError(
      `batchSize must be an integer between 1 and ${MAX_ERASURE_BATCH_SIZE}`,
    );
  }

  const candidates = await repository.listDue(batchSize, now);
  const result: ErasureRunResult = {
    candidates: candidates.length,
    erased: 0,
    cancelled: 0,
    stale: 0,
    failed: 0,
  };

  // Deliberately sequential: each candidate is one potentially large delete
  // transaction, and a bounded cron batch is safer than multiplying that
  // write load with in-process concurrency.
  for (const candidate of candidates) {
    try {
      const outcome = await repository.erase(candidate, now);
      result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      logger.error('[Erasure] Failed to erase one due revoked athlete', error);
    }
  }

  logger.info('[Erasure] Due-athlete erasure cycle complete', result);
  return result;
}
