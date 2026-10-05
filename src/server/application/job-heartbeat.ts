import 'server-only';

import { logger } from '~/server/logging/logger';
import {
  ingestionRepository,
  type IngestionRepository,
} from '~/server/repositories/ingestion';
import type { IngestionJob } from '~/server/strava/ingestion-policy';

type HeartbeatRepository = Pick<IngestionRepository, 'startJob' | 'finishJob'>;

// A heartbeat is observational: failing to store one must never fail the job.
async function observe(job: IngestionJob, write: () => Promise<void>) {
  try {
    await write();
  } catch (error) {
    logger.error('[Job heartbeat] Failed to record', { job, error });
  }
}

/**
 * Record when a scheduled ingestion job starts and how it finishes (issue
 * #296), so the status read model can tell a running scheduler from a stalled
 * or disabled one. `stopReason` keeps the job's own stop vocabulary.
 */
export function withJobHeartbeat<Args extends unknown[], Result>(
  job: IngestionJob,
  run: (...args: Args) => Promise<Result>,
  stopReason: (result: Result) => string | null,
  repository: HeartbeatRepository = ingestionRepository,
) {
  return async (...args: Args): Promise<Result> => {
    await observe(job, () => repository.startJob(job));
    try {
      const result = await run(...args);
      await observe(job, () =>
        repository.finishJob(job, {
          status: 'completed',
          stopReason: stopReason(result),
        }),
      );
      return result;
    } catch (error) {
      await observe(job, () =>
        repository.finishJob(job, { status: 'failed', stopReason: 'error' }),
      );
      throw error;
    }
  };
}

/** The server-side switch for `job` is off; the scheduler still called it. */
export async function recordJobDisabled(
  job: IngestionJob,
  repository: HeartbeatRepository = ingestionRepository,
) {
  await observe(job, async () => {
    await repository.startJob(job);
    await repository.finishJob(job, { status: 'disabled' });
  });
}
