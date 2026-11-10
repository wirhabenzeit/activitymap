import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import {
  activityMetadataValidator,
  photoValidator,
} from './activityValidators';
import { activityFor, applySourceRecord } from './activityWrites';
import { ownerFor, requireHead, writerOf } from './owners';
import { applyPhotoSet } from './photos';

/**
 * Convex ingestion for an owner Convex writes for
 * (docs/convex-writer-cutover.md, step 5).
 *
 * There is one job per owner and activity. A provider event (or anything
 * else that wants the activity brought up to date) calls `requestIngestion`,
 * which counts the request on the job and schedules a run for its due time;
 * nothing polls. A run is the Node action `ingestionWorker.run`:
 *
 * 1. `claim` gives it a lease and, for the `source` phase, a new source
 *    revision: the larger of the current time in milliseconds and one more
 *    than every revision already used for the activity, so revisions keep
 *    one order across a handoff from the mirror.
 * 2. `source` phase: the worker reads the activity (and its photos) through
 *    the provider gateway and `publishSource` writes them, or the deletion
 *    when the provider says the activity is gone.
 * 3. `recording` phase, only when the activity has no current recording:
 *    the worker reads the streams, stores the file and publishes it through
 *    the same fenced path the mirror uses.
 * 4. `complete` ends the run. If the activity was requested again while it
 *    ran, the job starts over at once.
 *
 * Every write names the job's claim. A worker whose lease was taken over
 * (it expired and `recover` or a later claim moved on) changes nothing, and
 * the library writes themselves refuse an owner that Convex no longer writes
 * for, so a run that started before a handoff cannot publish after it. Jobs
 * of such an owner stay queued and `resume` schedules them when Convex is
 * the writer again.
 *
 * Failures: a rate limit waits for the time the gateway names and counts no
 * attempt; rejected credentials block the job until the activity is
 * requested again; anything else is retried with a doubling delay and the
 * job is marked failed after `MAX_ATTEMPTS`.
 */

/** Longer than one provider read through the gateway can take. */
export const LEASE_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 10;
const RETRY_BASE_MS = 60_000;
const RETRY_CAP_MS = 6 * 60 * 60_000;
const RESUME_PAGE = 128;

export function retryDelayMs(attempt: number) {
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
}

export const activityIdOf = (key: string) => key.replace(/^0+/, '');

function schedule(ctx: MutationCtx, job: Id<'ingestionJobs'>, at: number) {
  return ctx.scheduler.runAt(at, internal.ingestionWorker.run, { job });
}

/** Whether Convex ingests for this owner right now. */
export function ingests(owner: Doc<'owners'> | null): owner is Doc<'owners'> {
  return (
    !!owner &&
    !owner.revoked &&
    owner.backend === 'convex' &&
    writerOf(owner) === 'convex'
  );
}

/**
 * Ask for an activity to be brought up to date. The caller has already
 * checked that Convex writes for the owner.
 */
export async function requestIngestion(
  ctx: MutationCtx,
  owner: Id<'owners'>,
  activity: string,
) {
  const now = Date.now();
  const job = await ctx.db
    .query('ingestionJobs')
    .withIndex('by_owner_activity', (q) =>
      q.eq('owner', owner).eq('activity', activity),
    )
    .unique();
  if (!job) {
    const id = await ctx.db.insert('ingestionJobs', {
      owner,
      activity,
      status: 'queued',
      phase: 'source',
      requested: 1,
      attempt: 0,
      dueAt: now,
      revision: 0,
      claims: 0,
    });
    await schedule(ctx, id, now);
    return id;
  }
  const requested = job.requested + 1;
  // A running job notices the new count when it completes.
  if (job.lease && job.lease.expiresAt > now) {
    await ctx.db.patch('ingestionJobs', job._id, { requested });
    return job._id;
  }
  // A job that waits for a retry keeps its time and its attempts: one more
  // event is no reason to ask the provider sooner.
  if (job.status === 'queued') {
    await ctx.db.patch('ingestionJobs', job._id, {
      requested,
      phase: 'source',
    });
    return job._id;
  }
  await ctx.db.patch('ingestionJobs', job._id, {
    requested,
    status: 'queued',
    phase: 'source',
    attempt: 0,
    dueAt: now,
    error: undefined,
  });
  await schedule(ctx, job._id, now);
  return job._id;
}

function needsRecording(row: Doc<'activities'> | null) {
  return (
    !!row?.dto &&
    !row.deleted &&
    // A manual activity has no samples to ask for.
    row.dto.manual !== true &&
    !(row.recording && row.projection?.streams?.state === 'current')
  );
}

/** What a recording run publishes against, or null when the activity needs
 * no recording. The stream store counts revisions up; a new recording
 * continues after the one it replaces. */
async function recordingTarget(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  activity: string,
) {
  const row = await activityFor(ctx, owner._id, activity);
  if (!row || !needsRecording(row)) return null;
  const prior =
    row.recording && (await ctx.db.get('recordings', row.recording));
  const last = [prior?.revision, row.projection?.streams?.revision]
    .filter((value): value is string => !!value && /^\d+$/.test(value))
    .map(BigInt)
    .reduce((a, b) => (a > b ? a : b), 0n);
  return {
    sourceRevision: row.sourceRevision,
    recording: {
      /** Null: the worker names a new generation. */
      generation: prior?.generation ?? null,
      revision: String(last + 1n),
    },
  };
}

function stepFor(
  owner: Doc<'owners'>,
  job: Doc<'ingestionJobs'>,
  claim: number,
  rest:
    | { phase: 'source'; sourceRevision: number }
    | (NonNullable<Awaited<ReturnType<typeof recordingTarget>>> & {
        phase: 'recording';
      }),
) {
  return {
    job: job._id,
    claim,
    scope: {
      userId: owner.userId,
      athleteId: owner.athleteId,
      epoch: owner.epoch,
    },
    id: activityIdOf(job.activity),
    generation: owner.generation,
    ...rest,
  };
}
export type IngestionStep = ReturnType<typeof stepFor>;

async function finish(ctx: MutationCtx, job: Doc<'ingestionJobs'>) {
  const now = Date.now();
  if (job.lease && job.lease.requested !== job.requested) {
    await ctx.db.patch('ingestionJobs', job._id, {
      status: 'queued',
      phase: 'source',
      attempt: 0,
      dueAt: now,
      lease: undefined,
      error: undefined,
    });
    await schedule(ctx, job._id, now);
    return;
  }
  await ctx.db.patch('ingestionJobs', job._id, {
    status: 'idle',
    phase: 'source',
    attempt: 0,
    dueAt: undefined,
    lease: undefined,
    error: undefined,
  });
}

async function retry(
  ctx: MutationCtx,
  job: Doc<'ingestionJobs'>,
  reason: string,
) {
  const attempt = job.attempt + 1;
  if (attempt >= MAX_ATTEMPTS) {
    await ctx.db.patch('ingestionJobs', job._id, {
      status: 'failed',
      attempt,
      dueAt: undefined,
      lease: undefined,
      error: reason,
    });
    return;
  }
  const dueAt = Date.now() + retryDelayMs(attempt);
  await ctx.db.patch('ingestionJobs', job._id, {
    status: 'queued',
    attempt,
    dueAt,
    lease: undefined,
    error: reason,
  });
  await schedule(ctx, job._id, dueAt);
}

/** The job and its owner if `claim` still holds the lease. */
async function held(ctx: QueryCtx, id: Id<'ingestionJobs'>, claim: number) {
  const job = await ctx.db.get('ingestionJobs', id);
  if (job?.lease?.claim !== claim) return null;
  return { job, owner: await ctx.db.get('owners', job.owner) };
}

/** Take a due job. Null when it is not due, another run holds it, or Convex
 * does not ingest for its owner. */
export const claim = internalMutation({
  args: { job: v.id('ingestionJobs') },
  handler: async (ctx, args): Promise<IngestionStep | null> => {
    const now = Date.now();
    const job = await ctx.db.get('ingestionJobs', args.job);
    if (
      !job ||
      job.status !== 'queued' ||
      job.dueAt === undefined ||
      job.dueAt > now ||
      (job.lease && job.lease.expiresAt > now)
    )
      return null;
    const owner = await ctx.db.get('owners', job.owner);
    if (!ingests(owner)) return null;
    const number = job.claims + 1;
    const lease = {
      claim: number,
      expiresAt: now + LEASE_MS,
      requested: job.requested,
    };
    // An expired lease that nothing recovered yet was a lost run.
    const attempt = job.attempt + (job.lease ? 1 : 0);
    await ctx.scheduler.runAt(lease.expiresAt, internal.ingestion.recover, {
      job: job._id,
      claim: number,
    });
    if (job.phase === 'recording') {
      const target = await recordingTarget(ctx, owner, job.activity);
      if (target) {
        await ctx.db.patch('ingestionJobs', job._id, {
          claims: number,
          lease,
          attempt,
        });
        return stepFor(owner, job, number, { phase: 'recording', ...target });
      }
      // Nothing left to record (deleted or recorded meanwhile): look at the
      // source again instead.
    }
    const [row, set, head] = await Promise.all([
      activityFor(ctx, owner._id, job.activity),
      ctx.db
        .query('photoSets')
        .withIndex('by_owner_activity', (q) =>
          q.eq('owner', owner._id).eq('activity', job.activity),
        )
        .unique(),
      requireHead(ctx, owner._id),
    ]);
    const revision = Math.max(
      now,
      job.revision + 1,
      (row?.sourceRevision ?? 0) + 1,
      (set?.revision ?? 0) + 1,
      (head.mirror?.revision ?? 0) + 1,
    );
    await ctx.db.patch('ingestionJobs', job._id, {
      phase: 'source',
      claims: number,
      lease,
      attempt,
      revision,
    });
    return stepFor(owner, job, number, {
      phase: 'source',
      sourceRevision: revision,
    });
  },
});

/** Write what the provider says about the activity: its current state and
 * photo set, or its deletion (`dto: null`). Returns the recording step when
 * the activity now needs a recording, and null when the run is over or the
 * claim no longer holds the job. */
export const publishSource = internalMutation({
  args: {
    job: v.id('ingestionJobs'),
    claim: v.number(),
    dto: v.union(activityMetadataValidator, v.null()),
    /** The activity's current photo set; absent when it was not read. */
    photos: v.optional(v.array(photoValidator)),
  },
  handler: async (ctx, args): Promise<IngestionStep | null> => {
    const holder = await held(ctx, args.job, args.claim);
    if (!holder?.owner) return null;
    const { job, owner } = holder;
    const fence = {
      scope: {
        userId: owner.userId,
        athleteId: owner.athleteId,
        epoch: owner.epoch,
      },
      generation: owner.generation,
      sourceRevision: job.revision,
      writer: 'convex' as const,
    };
    const id = activityIdOf(job.activity);
    // Refuses an owner Convex does not write for, which fails the run.
    await applySourceRecord(ctx, { ...fence, id, dto: args.dto });
    if (args.dto && args.photos)
      await applyPhotoSet(ctx, {
        ...fence,
        activityId: id,
        photos: args.photos,
      });
    const target =
      args.dto && job.lease!.requested === job.requested
        ? await recordingTarget(ctx, owner, job.activity)
        : null;
    if (!target) {
      await finish(ctx, job);
      return null;
    }
    const lease = { ...job.lease!, expiresAt: Date.now() + LEASE_MS };
    await ctx.db.patch('ingestionJobs', job._id, {
      phase: 'recording',
      attempt: 0,
      error: undefined,
      lease,
    });
    await ctx.scheduler.runAt(lease.expiresAt, internal.ingestion.recover, {
      job: job._id,
      claim: args.claim,
    });
    return stepFor(owner, job, args.claim, { phase: 'recording', ...target });
  },
});

/** End a run whose last phase is done. */
export const complete = internalMutation({
  args: { job: v.id('ingestionJobs'), claim: v.number() },
  handler: async (ctx, args) => {
    const holder = await held(ctx, args.job, args.claim);
    if (holder) await finish(ctx, holder.job);
  },
});

/** End a run that did not finish. */
export const fail = internalMutation({
  args: {
    job: v.id('ingestionJobs'),
    claim: v.number(),
    failure: v.union(
      v.object({
        kind: v.literal('rate_limited'),
        retryAfterSeconds: v.number(),
      }),
      v.object({ kind: v.literal('blocked'), reason: v.string() }),
      v.object({ kind: v.literal('retry'), reason: v.string() }),
      v.object({ kind: v.literal('permanent'), reason: v.string() }),
    ),
  },
  handler: async (ctx, { failure, ...args }) => {
    const holder = await held(ctx, args.job, args.claim);
    if (!holder) return;
    const { job, owner } = holder;
    const now = Date.now();
    if (!ingests(owner)) {
      // Not a failure of the activity: the owner was handed off (or is
      // gone) while the run was under way. `resume` schedules it again.
      await ctx.db.patch('ingestionJobs', job._id, {
        status: 'queued',
        dueAt: now,
        lease: undefined,
        error: 'fenced',
      });
      return;
    }
    switch (failure.kind) {
      case 'rate_limited': {
        const dueAt =
          now + Math.max(1, Math.ceil(failure.retryAfterSeconds)) * 1000;
        await ctx.db.patch('ingestionJobs', job._id, {
          status: 'queued',
          dueAt,
          lease: undefined,
          error: 'rate_limited',
        });
        await schedule(ctx, job._id, dueAt);
        return;
      }
      case 'blocked':
      case 'permanent':
        await ctx.db.patch('ingestionJobs', job._id, {
          status: failure.kind === 'blocked' ? 'blocked' : 'failed',
          dueAt: undefined,
          lease: undefined,
          error: failure.reason.slice(0, 200),
        });
        return;
      case 'retry':
        await retry(ctx, job, failure.reason.slice(0, 200));
    }
  },
});

/** Scheduled for the end of every lease: a run that neither finished nor
 * failed by then was lost, and the job is retried. */
export const recover = internalMutation({
  args: { job: v.id('ingestionJobs'), claim: v.number() },
  handler: async (ctx, args) => {
    const holder = await held(ctx, args.job, args.claim);
    // A later lease of the same claim (the next phase) has its own recovery.
    if (!holder || holder.job.lease!.expiresAt > Date.now()) return;
    if (!ingests(holder.owner)) {
      await ctx.db.patch('ingestionJobs', holder.job._id, {
        status: 'queued',
        dueAt: Date.now(),
        lease: undefined,
        error: 'fenced',
      });
      return;
    }
    await retry(ctx, holder.job, 'lease_expired');
  },
});

/** Schedule the owner's queued jobs. Runs when Convex becomes the owner's
 * writer (owners.setWriter): jobs that were refused while another store
 * wrote have no scheduled run of their own any more. */
export const resume = internalMutation({
  args: { owner: v.id('owners'), after: v.optional(v.string()) },
  handler: async (ctx, { owner, after }) => {
    if (!ingests(await ctx.db.get('owners', owner))) return;
    const now = Date.now();
    const jobs = await ctx.db
      .query('ingestionJobs')
      .withIndex('by_owner_status', (q) =>
        q
          .eq('owner', owner)
          .eq('status', 'queued')
          .gt('activity', after ?? ''),
      )
      .take(RESUME_PAGE);
    for (const job of jobs)
      if (!job.lease || job.lease.expiresAt <= now)
        await schedule(ctx, job._id, Math.max(now, job.dueAt ?? now));
    if (jobs.length === RESUME_PAGE)
      await ctx.scheduler.runAfter(0, internal.ingestion.resume, {
        owner,
        after: jobs.at(-1)!.activity,
      });
  },
});

/** The owner's jobs that are not idle, for an operator:
 * `convex run ingestion:status '{"userId":"<userId>"}'`. */
export const status = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const owner = await ownerFor(ctx, userId);
    if (!owner) return [];
    const jobs = await Promise.all(
      (['queued', 'blocked', 'failed'] as const).map((state) =>
        ctx.db
          .query('ingestionJobs')
          .withIndex('by_owner_status', (q) =>
            q.eq('owner', owner._id).eq('status', state),
          )
          .take(50),
      ),
    );
    return jobs.flat().map((job) => ({
      activity: activityIdOf(job.activity),
      status: job.status,
      phase: job.phase,
      attempt: job.attempt,
      dueAt: job.dueAt ?? null,
      running: !!job.lease && job.lease.expiresAt > Date.now(),
      error: job.error ?? null,
    }));
  },
});
