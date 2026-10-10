/**
 * One activity that failed during a scheduled run, as kept in the run's
 * `scheduled_job_log.summary.failures`. The attempt tables only keep a
 * coarse code; this keeps the actual cause long enough to diagnose it.
 */
export type RunFailure = {
  activityId: string;
  code: string;
  detail: string;
};

/** A run's numeric/boolean result fields, plus its first few `failures`. */
export type JobRunSummary = Record<string, number | boolean | RunFailure[]>;

export const runFailures = (summary: JobRunSummary | null): RunFailure[] =>
  Array.isArray(summary?.failures) ? summary.failures : [];
