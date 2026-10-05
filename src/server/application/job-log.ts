import 'server-only';

import { logger } from '~/server/logging/logger';
import {
  scheduledJobLogRepository,
  type NewScheduledJobLogEntry,
} from '~/server/repositories/scheduled-job-log';

import type { ScheduledJob } from '~/lib/admin/job-health';

/** How long the admin dashboard keeps run history. */
export const JOB_LOG_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const MAX_SUMMARY_FIELDS = 16;
const MAX_ERROR_CHARS = 300;

export interface JobLogWriter {
  append(entry: NewScheduledJobLogEntry): Promise<void>;
}

/**
 * The numeric and boolean top-level fields of a job's result, such as
 * `fetched` or `stoppedForRateLimit`. Strings and nested objects are left out
 * so no activity names, tokens or upstream payloads reach the log.
 */
export function summarizeJobResult(
  result: unknown,
): Record<string, number | boolean> | null {
  if (typeof result === 'number') return { result };
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return null;
  const summary: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(result)) {
    if (Object.keys(summary).length >= MAX_SUMMARY_FIELDS) break;
    if (
      (typeof value === 'number' && Number.isFinite(value)) ||
      typeof value === 'boolean'
    )
      summary[key] = value;
  }
  return Object.keys(summary).length > 0 ? summary : null;
}

/** A short, single-line error message: never a stack or response body. */
export function describeJobError(error: unknown): string {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const line = message.split('\n')[0]!.trim();
  return line.length > MAX_ERROR_CHARS
    ? `${line.slice(0, MAX_ERROR_CHARS - 1)}…`
    : line;
}

// The log is observational: failing to write it must never fail the job.
async function write(writer: JobLogWriter, entry: NewScheduledJobLogEntry) {
  try {
    await writer.append(entry);
  } catch (error) {
    logger.error('[Job log] Failed to record', { job: entry.job, error });
  }
}

/**
 * Appends one `scheduled_job_log` row per run of `run`: duration, outcome,
 * the result's numeric summary and, on failure, a short error. The result or
 * error passes through unchanged.
 */
export function withJobLog<Args extends unknown[], Result>(
  job: ScheduledJob,
  run: (...args: Args) => Promise<Result>,
  options: {
    stopReason?: (result: Result) => string | null;
    summarize?: (result: Result) => Record<string, number | boolean> | null;
    writer?: JobLogWriter;
    clock?: () => number;
  } = {},
) {
  const clock = options.clock ?? Date.now;
  const writer = options.writer ?? scheduledJobLogRepository;
  return async (...args: Args): Promise<Result> => {
    const started = clock();
    try {
      const result = await run(...args);
      await write(writer, {
        job,
        startedAt: new Date(started),
        durationMs: Math.max(0, clock() - started),
        status: 'completed',
        stopReason: options.stopReason?.(result) ?? null,
        summary: (options.summarize ?? summarizeJobResult)(result),
        error: null,
      });
      return result;
    } catch (error) {
      await write(writer, {
        job,
        startedAt: new Date(started),
        durationMs: Math.max(0, clock() - started),
        status: 'failed',
        stopReason: null,
        summary: null,
        error: describeJobError(error),
      });
      throw error;
    }
  };
}

/** The job's server-side switch is off; the scheduler still called it. */
export async function recordJobLogDisabled(
  job: ScheduledJob,
  writer: JobLogWriter = scheduledJobLogRepository,
) {
  await write(writer, {
    job,
    startedAt: new Date(),
    durationMs: 0,
    status: 'disabled',
    stopReason: null,
    summary: null,
    error: null,
  });
}
