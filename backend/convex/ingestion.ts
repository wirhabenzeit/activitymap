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
  placeMatchValidator,
} from './activityValidators';
import {
  activityFor,
  applySourceRecord,
  publishMatchRecord,
} from './activityWrites';
import { project } from './liveProjection';
import { scopeFields } from './ownerScope';
import {
  idKey,
  ownerFor,
  requireHead,
  requireWritableOwner,
  writerOf,
} from './owners';
import { applyPhotoSet, photosOfActivities } from './photos';

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
 *    the same fenced path the mirror uses. An activity without samples (one
 *    typed in by hand, or one the provider has no streams for) gets an empty
 *    recording, which is how "nothing to fetch" is remembered.
 * 4. `match` phase, when the activity has a current recording without a
 *    match for the owner's catalogue: the worker matches it against the
 *    copied place catalogue and `matched` publishes the result.
 * 5. The run ends. If the activity was requested again while it ran, the
 *    job starts over at once.
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
    !(row.recording && row.projection?.streams?.state === 'current')
  );
}

/** Whether reconciliation should ask for an activity although its summary
 * has not changed: it was never read in full, its photos are out of date, or
 * it has no recording. An activity without samples gets an empty recording,
 * so this ends once each activity has been read. */
export function incomplete(row: Doc<'activities'>) {
  return (
    !!row.dto &&
    !row.deleted &&
    (row.dto.geometry_state !== 'detailed' ||
      row.dto.photos_state === 'refresh_required' ||
      needsRecording(row))
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
    phase: 'recording' as const,
    sourceRevision: row.sourceRevision,
    /** Typed in by hand: there are no samples to ask the provider for. */
    manual: row.dto?.manual === true,
    recording: {
      /** Null: the worker names a new generation. */
      generation: prior?.generation ?? null,
      revision: String(last + 1n),
    },
  };
}

/** What a matching run needs, or null when the activity has no current
 * recording or already has a match for the owner's catalogue. `catalogues`
 * are the newest complete rowsets; the worker uses the one the owner's
 * matching version names. */
async function matchTarget(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  activity: string,
) {
  const row = await activityFor(ctx, owner._id, activity);
  if (
    !row?.dto ||
    row.deleted ||
    !row.recording ||
    row.projection?.streams?.state !== 'current' ||
    row.projection.match?.catalogue === owner.catalogue
  )
    return null;
  const recording = await ctx.db.get('recordings', row.recording);
  if (!recording) return null;
  const rowsets = await ctx.db.query('placeCatalogues').order('desc').take(8);
  return {
    phase: 'match' as const,
    sourceRevision: row.sourceRevision,
    recording: {
      id: recording._id,
      file: recording.file,
      manifest: recording.manifest,
      generation: recording.generation,
      revision: recording.revision,
    },
    matchingVersion: owner.matchingVersion,
    catalogues: rowsets
      .filter((rowset) => rowset.complete)
      .map(({ dataset, snapshotId, revision, metadata }) => ({
        dataset,
        snapshotId,
        revision,
        metadata,
      })),
  };
}

/** The phase that follows the source: a recording when the activity has no
 * current one, then its place match. */
async function nextTarget(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  activity: string,
) {
  return (
    (await recordingTarget(ctx, owner, activity)) ??
    (await matchTarget(ctx, owner, activity))
  );
}

function stepFor(
  owner: Doc<'owners'>,
  job: Doc<'ingestionJobs'>,
  claim: number,
  rest:
    | { phase: 'source'; sourceRevision: number }
    | NonNullable<Awaited<ReturnType<typeof nextTarget>>>,
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

/** A new source revision for the job's activity: the larger of the current
 * time in milliseconds and one more than every revision already used for
 * it, so revisions keep one order across a handoff from the mirror. */
async function nextRevision(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  job: Pick<Doc<'ingestionJobs'>, 'activity' | 'revision'>,
) {
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
  return Math.max(
    Date.now(),
    job.revision + 1,
    (row?.sourceRevision ?? 0) + 1,
    (set?.revision ?? 0) + 1,
    (head.mirror?.revision ?? 0) + 1,
  );
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
    if (job.phase !== 'source') {
      const target = await nextTarget(ctx, owner, job.activity);
      if (target) {
        await ctx.db.patch('ingestionJobs', job._id, {
          phase: target.phase,
          claims: number,
          lease,
          attempt,
        });
        return stepFor(owner, job, number, target);
      }
      // Nothing left to record or match (deleted, or done meanwhile): look
      // at the source again instead.
    }
    const revision = await nextRevision(ctx, owner, job);
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
    if (!args.dto) {
      await finish(ctx, job);
      return null;
    }
    return proceed(ctx, owner, job, args.claim);
  },
});

/** Move a run to its next phase, or end it. An activity that was requested
 * again meanwhile starts over instead. */
async function proceed(
  ctx: MutationCtx,
  owner: Doc<'owners'>,
  job: Doc<'ingestionJobs'>,
  claim: number,
  /** Which phases may follow. A run asks for a recording once: after the
   * recording phase only the match is left, whatever became of the file. */
  target_: typeof nextTarget | typeof matchTarget = nextTarget,
): Promise<IngestionStep | null> {
  const target =
    job.lease!.requested === job.requested
      ? await target_(ctx, owner, job.activity)
      : null;
  if (!target) {
    await finish(ctx, job);
    return null;
  }
  const lease = { ...job.lease!, expiresAt: Date.now() + LEASE_MS };
  await ctx.db.patch('ingestionJobs', job._id, {
    phase: target.phase,
    attempt: 0,
    error: undefined,
    lease,
  });
  await ctx.scheduler.runAt(lease.expiresAt, internal.ingestion.recover, {
    job: job._id,
    claim,
  });
  return stepFor(owner, job, claim, target);
}

/** After a recording was published: the match step, or the end of the run. */
export const advance = internalMutation({
  args: { job: v.id('ingestionJobs'), claim: v.number() },
  handler: async (ctx, args): Promise<IngestionStep | null> => {
    const holder = await held(ctx, args.job, args.claim);
    if (!holder?.owner) return null;
    return proceed(ctx, holder.owner, holder.job, args.claim, matchTarget);
  },
});

/** Publish the match computed for the activity's current recording, and end
 * the run. A result for a recording that has been replaced is dropped. */
export const matched = internalMutation({
  args: {
    job: v.id('ingestionJobs'),
    claim: v.number(),
    recording: v.id('recordings'),
    result: placeMatchValidator,
  },
  handler: async (ctx, args) => {
    const holder = await held(ctx, args.job, args.claim);
    if (!holder?.owner) return;
    const { job, owner } = holder;
    const row = await activityFor(ctx, owner._id, job.activity);
    // Refuses an owner Convex does not write for, which fails the run.
    await publishMatchRecord(ctx, {
      scope: {
        userId: owner.userId,
        athleteId: owner.athleteId,
        epoch: owner.epoch,
      },
      id: activityIdOf(job.activity),
      generation: owner.generation,
      sourceRevision: row?.sourceRevision ?? job.revision,
      writer: 'convex',
      recording: args.recording,
      catalogue: owner.catalogue,
      result: args.result,
    });
    await finish(ctx, job);
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

/** Whether the activity is in the library of an owner Convex writes for.
 * A command checks this before it changes anything at the provider. */
export const known = internalQuery({
  args: { scope: v.object(scopeFields), id: v.string() },
  handler: async (ctx, { scope, id }): Promise<boolean> => {
    const owner = await requireWritableOwner(ctx, scope, 'convex');
    const row = await activityFor(ctx, owner._id, idKey(id));
    return !!row?.dto && !row.deleted && row.generation === owner.generation;
  },
});

/**
 * Write what a command (an edit or a refresh in the app) just learned from
 * the provider about an activity already in the library: its current state
 * with, when the command read them, its photos, or its deletion
 * (`dto: null`). The app made the provider call; this is the same write a
 * job's source phase makes, with a new revision, so a run that read the
 * activity earlier loses to it. Returns what clients now see, or null when
 * the activity is not in the library.
 *
 * When the activity now needs a recording or a match, its job is queued for
 * that phase; a job that is running is asked to run again afterwards.
 */
export const apply = internalMutation({
  args: {
    scope: v.object(scopeFields),
    id: v.string(),
    dto: v.union(activityMetadataValidator, v.null()),
    /** The activity's current photo set; absent when it was not read. */
    photos: v.optional(v.array(photoValidator)),
  },
  handler: async (ctx, args) => {
    const owner = await requireWritableOwner(ctx, args.scope, 'convex');
    const activity = idKey(args.id);
    const prior = await activityFor(ctx, owner._id, activity);
    if (!prior?.dto || prior.deleted || prior.generation !== owner.generation)
      return null;
    const byActivity = () =>
      ctx.db
        .query('ingestionJobs')
        .withIndex('by_owner_activity', (q) =>
          q.eq('owner', owner._id).eq('activity', activity),
        )
        .unique();
    const job =
      (await byActivity()) ??
      (await ctx.db.get(
        'ingestionJobs',
        await ctx.db.insert('ingestionJobs', {
          owner: owner._id,
          activity,
          status: 'idle',
          phase: 'source',
          requested: 0,
          attempt: 0,
          revision: 0,
          claims: 0,
        }),
      ))!;
    const revision = await nextRevision(ctx, owner, job);
    await ctx.db.patch('ingestionJobs', job._id, { revision });
    const fence = {
      scope: args.scope,
      generation: owner.generation,
      sourceRevision: revision,
      writer: 'convex' as const,
    };
    await applySourceRecord(ctx, {
      ...fence,
      id: args.id,
      dto:
        args.dto && !args.photos
          ? // The photos were not read: what is known about them stands.
            { ...args.dto, photos_state: prior.dto.photos_state }
          : args.dto,
    });
    if (!args.dto) return { activity: null, photos: [] };
    if (args.photos)
      await applyPhotoSet(ctx, {
        ...fence,
        activityId: args.id,
        photos: args.photos,
      });
    const now = Date.now();
    if (await nextTarget(ctx, owner, activity)) {
      if (job.lease && job.lease.expiresAt > now)
        await ctx.db.patch('ingestionJobs', job._id, {
          requested: job.requested + 1,
        });
      else if (job.status !== 'queued') {
        // Straight to the phase that is missing: the source is current.
        await ctx.db.patch('ingestionJobs', job._id, {
          status: 'queued',
          phase: 'recording',
          attempt: 0,
          dueAt: now,
          error: undefined,
        });
        await schedule(ctx, job._id, now);
      }
    }
    const row = await activityFor(ctx, owner._id, activity);
    return {
      activity: row && project(row, owner),
      photos: await photosOfActivities(ctx, owner, [args.id]),
    };
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
