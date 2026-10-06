/**
 * How often each scheduled job is expected to start, matching the
 * `activitymap-cron` Worker (docs/scheduled-jobs.md). `null` means the job
 * has no schedule and only runs when triggered by hand.
 */
export const SCHEDULED_JOB_INTERVALS = {
  'drain-webhook-inbox': 5 * 60_000,
  'cleanup-rate-limits': 60 * 60_000,
  'erase-revoked-athletes': 60 * 60_000,
  'reconcile-strava-summaries': 60 * 60_000,
  'backfill-activity-streams': 60 * 60_000,
  'backfill-activity-photos': 60 * 60_000,
  'sync-activities': null,
} as const satisfies Record<string, number | null>;

export type ScheduledJob = keyof typeof SCHEDULED_JOB_INTERVALS;

/** A job is late once this many expected intervals pass without a start. */
const LATE_AFTER_INTERVALS = 2.5;

export type JobRun = {
  job: string;
  startedAt: Date;
  status: 'completed' | 'failed' | 'disabled';
};

export type JobHealth =
  'ok' | 'late' | 'failing' | 'disabled' | 'no_runs' | 'unscheduled';

/**
 * Each job's health from its recent runs (newest first or in any order):
 * failing if its latest run failed, disabled if its switch is off, late if
 * it hasn't started for 2.5 intervals, otherwise ok.
 */
export function jobHealth(runs: readonly JobRun[], now: Date) {
  return (Object.keys(SCHEDULED_JOB_INTERVALS) as ScheduledJob[]).map((job) => {
    const own = runs
      .filter((run) => run.job === job)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const latest = own[0] ?? null;
    const lastSuccess = own.find((run) => run.status === 'completed') ?? null;
    const failures = own.filter((run) => run.status === 'failed').length;
    const interval: number | null = SCHEDULED_JOB_INTERVALS[job];
    let health: JobHealth;
    if (interval === null && !latest) health = 'unscheduled';
    else if (!latest) health = 'no_runs';
    else if (latest.status === 'failed') health = 'failing';
    else if (latest.status === 'disabled') health = 'disabled';
    else if (
      interval !== null &&
      now.getTime() - latest.startedAt.getTime() >
        LATE_AFTER_INTERVALS * interval
    )
      health = 'late';
    else health = 'ok';
    return {
      job,
      interval,
      health,
      latest,
      lastSuccess,
      runs: own.length,
      failures,
    };
  });
}
