import { v } from 'convex/values';

import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
} from './_generated/server';

/**
 * The last success of each scheduled job, for the operator dashboard
 * (convex/admin.ts). Convex keeps no cron history that functions can read,
 * and a failed mutation rolls back its writes, so a job is late when its
 * success is missing: each job records it in the transaction of its work.
 */

const HOUR = 60 * 60_000;

/** Every scheduled job and how often it runs. The Convex crons
 * (convex/crons.ts) take their intervals from here. */
export const JOBS = {
  'compact-changes': { hours: 24 },
  'expire-nonces': { hours: 1 },
  'expire-provider-events': { hours: 24 },
  'expire-rate-limits': { hours: 24 },
  'resume-rematch-walks': { hours: 24 },
  /** The app's, run hourly by the Cloudflare cron Worker
   * (docs/scheduled-jobs.md); it reports through the auth bridge. */
  'erase-revoked-athletes': { hours: 1 },
} as const;
export type Job = keyof typeof JOBS;

export const jobValidator = v.union(
  ...(Object.keys(JOBS) as Job[]).map((job) => v.literal(job)),
);

/** Record that the job did its work now. */
export async function succeeded(ctx: MutationCtx, job: Job) {
  const row = await ctx.db
    .query('jobHeartbeats')
    .withIndex('by_job', (q) => q.eq('job', job))
    .unique();
  const succeededAt = Date.now();
  if (row) await ctx.db.patch('jobHeartbeats', row._id, { succeededAt });
  else await ctx.db.insert('jobHeartbeats', { job, succeededAt });
}

/** A success reported from outside Convex. */
export const record = internalMutation({
  args: { job: jobValidator },
  handler: (ctx, { job }) => succeeded(ctx, job),
});

/** Every job with its interval and last success (null: none recorded). */
export async function jobHealth(ctx: QueryCtx) {
  const rows = await ctx.db.query('jobHeartbeats').take(64);
  return (Object.keys(JOBS) as Job[]).map((job) => ({
    job,
    intervalMs: JOBS[job].hours * HOUR,
    succeededAt: rows.find((row) => row.job === job)?.succeededAt ?? null,
  }));
}
