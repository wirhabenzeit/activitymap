/**
 * Which ActivityMap cron endpoints each Cloudflare cron trigger calls, and in
 * what order. The endpoints enforce their own leases, hourly caps and pause
 * switches.
 */
export interface CronJob {
  name: string;
  path: string;
  body?: Record<string, unknown>;
  /** Skip this job when the named earlier job in the same trigger failed. */
  requires?: string;
}

export const SCHEDULES: Record<string, CronJob[]> = {
  // New and changed activities arrive through Strava webhooks.
  '*/5 * * * *': [
    { name: 'drain-webhook-inbox', path: '/api/cron/drain-webhook-inbox' },
  ],
  // Offset from the webhook trigger so the quarter-hour drain finishes first.
  '2,17,32,47 * * * *': [
    { name: 'match-activity-places', path: '/api/cron/match-activity-places' },
  ],
  '0 * * * *': [
    { name: 'cleanup-rate-limits', path: '/api/cron/cleanup-rate-limits' },
    {
      name: 'erase-revoked-athletes',
      path: '/api/cron/erase-revoked-athletes',
    },
  ],
  '37 * * * *': [
    {
      name: 'reconcile-strava-summaries',
      path: '/api/cron/reconcile-strava-summaries',
      body: { batchSize: 1, pagesPerAthlete: 3 },
    },
    {
      name: 'backfill-activity-streams',
      path: '/api/cron/backfill-activity-streams',
      body: { activityLimit: 40, requestLimit: 60 },
      requires: 'reconcile-strava-summaries',
    },
    {
      name: 'backfill-activity-photos',
      path: '/api/cron/backfill-activity-photos',
    },
  ],
  // Fills in full activity details for summaries and imports older history.
  '47 * * * *': [
    {
      name: 'sync-activities',
      path: '/api/cron/sync-activities',
      body: {
        maxIncompleteActivities: 30,
        maxOldActivities: 30,
        minActivitiesThreshold: 2,
      },
    },
  ],
};

export interface JobResult {
  name: string;
  status: number | 'skipped' | 'error';
  body: string;
}

const RESPONSE_PREVIEW_CHARS = 500;

/**
 * Runs one trigger's jobs in order. A failed job doesn't stop the jobs after
 * it, except those that `require` it.
 */
export async function runSchedule(
  cron: string,
  options: {
    baseUrl: string;
    cronSecret: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<JobResult[]> {
  const jobs = SCHEDULES[cron];
  if (!jobs) throw new Error(`No jobs are configured for cron "${cron}"`);
  const doFetch = options.fetch ?? fetch;
  const results: JobResult[] = [];
  for (const job of jobs) {
    const prerequisite = job.requires
      ? results.find((result) => result.name === job.requires)
      : undefined;
    if (prerequisite && !isSuccess(prerequisite)) {
      results.push({
        name: job.name,
        status: 'skipped',
        body: `${job.requires} did not succeed`,
      });
      continue;
    }
    try {
      const response = await doFetch(new URL(job.path, options.baseUrl), {
        method: 'POST',
        headers: {
          'x-cron-secret': options.cronSecret,
          ...(job.body ? { 'content-type': 'application/json' } : {}),
        },
        body: job.body ? JSON.stringify(job.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });
      const text = await response.text();
      results.push({
        name: job.name,
        status: response.status,
        body: text.slice(0, RESPONSE_PREVIEW_CHARS),
      });
    } catch (error) {
      results.push({
        name: job.name,
        status: 'error',
        body: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export function isSuccess(result: JobResult): boolean {
  return typeof result.status === 'number' && result.status < 300;
}
