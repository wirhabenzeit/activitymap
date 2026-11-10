import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { activityFor } from './activityWrites';
import { LEASE_MS, ingests, requestIngestion, retryDelayMs } from './ingestion';
import { idKey, ownerFor } from './owners';

/**
 * Reconciliation for an owner Convex writes for: the backstop for provider
 * events that never arrive (docs/convex-writer-cutover.md, step 5).
 *
 * Each owner has one sweep row. A sweep is due when Convex becomes the
 * owner's writer and then every `SWEEP_INTERVAL_MS` after the last one
 * finished. It never writes an activity itself; it only asks the activity's
 * ingestion job (convex/ingestion.ts), which reads the activity in full.
 *
 * - **Scanning.** The worker (`ingestionWorker.sweep`) reads the provider's
 *   list of the owner's activities page by page. For every summary,
 *   `applyPage` records a fingerprint on the activity's job and asks for the
 *   activity when it is unknown here, when its fingerprint differs from the
 *   one recorded by the previous sweep, or when its job is blocked or
 *   failed. The first time a known activity is seen there is no fingerprint
 *   to compare with, so the summary is compared with the stored activity.
 *   An empty page ends the scan.
 * - **Confirming.** An activity that the list did not contain is not
 *   thereby deleted. `confirm` walks the library and asks for each activity
 *   the scan did not see; the job's detail read decides whether it is gone.
 *   At most `CONFIRM_LIMIT` are asked for per hour, so a list that is wrong
 *   cannot spend the request budget on the whole library at once.
 *
 * Leases, claims and the writer check work as they do for jobs.
 */

export const SWEEP_INTERVAL_MS = 6 * 24 * 60 * 60_000;
export const CONFIRM_LIMIT = 20;
export const CONFIRM_INTERVAL_MS = 60 * 60_000;
const CONFIRM_PAGE = 200;
/** Rejected credentials: look again once a day. */
const BLOCKED_RETRY_MS = 24 * 60 * 60_000;
export const SWEEP_PAGE_SIZE = 100;

/** The summary fields a sweep compares with a stored activity. */
const summaryFields = {
  name: v.string(),
  sport_type: v.string(),
  distance: v.union(v.number(), v.null()),
  moving_time: v.union(v.number(), v.null()),
  elapsed_time: v.union(v.number(), v.null()),
  total_elevation_gain: v.union(v.number(), v.null()),
  start_date: v.string(),
  private: v.union(v.boolean(), v.null()),
  map_summary_polyline: v.union(v.string(), v.null()),
  photo_count: v.union(v.number(), v.null()),
  total_photo_count: v.union(v.number(), v.null()),
};

function sweepFor(ctx: QueryCtx, owner: Id<'owners'>) {
  return ctx.db
    .query('ingestionSweeps')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .unique();
}

function schedule(ctx: MutationCtx, owner: Id<'owners'>, at: number) {
  return ctx.scheduler.runAt(at, internal.ingestionWorker.sweep, { owner });
}

function jobFor(ctx: QueryCtx, owner: Id<'owners'>, activity: string) {
  return ctx.db
    .query('ingestionJobs')
    .withIndex('by_owner_activity', (q) =>
      q.eq('owner', owner).eq('activity', activity),
    )
    .unique();
}

/** The sweep and its owner if `claim` still holds the lease. */
async function held(ctx: QueryCtx, owner: Id<'owners'>, claim: number) {
  const sweep = await sweepFor(ctx, owner);
  if (sweep?.lease?.claim !== claim) return null;
  return { sweep, owner: await ctx.db.get('owners', owner) };
}

async function release(
  ctx: MutationCtx,
  sweep: Doc<'ingestionSweeps'>,
  dueAt: number,
  fields: Partial<Doc<'ingestionSweeps'>> = {},
) {
  await ctx.db.patch('ingestionSweeps', sweep._id, {
    lease: undefined,
    error: undefined,
    attempt: 0,
    ...fields,
    dueAt,
  });
  await schedule(ctx, sweep.owner, dueAt);
}

async function extend(
  ctx: MutationCtx,
  sweep: Doc<'ingestionSweeps'>,
  claim: number,
  fields: Partial<Doc<'ingestionSweeps'>>,
) {
  const lease = { claim, expiresAt: Date.now() + LEASE_MS };
  await ctx.db.patch('ingestionSweeps', sweep._id, {
    ...fields,
    lease,
    attempt: 0,
    error: undefined,
  });
  await ctx.scheduler.runAt(lease.expiresAt, internal.ingestionSweep.recover, {
    owner: sweep.owner,
    claim,
  });
}

function stepFor(
  owner: Doc<'owners'>,
  claim: number,
  sweep: Pick<Doc<'ingestionSweeps'>, 'phase' | 'page' | 'scanBefore'>,
) {
  return {
    claim,
    owner: owner._id,
    userId: owner.userId,
    athleteId: owner.athleteId,
    phase: sweep.phase as 'scanning' | 'confirming',
    page: sweep.page,
    before: sweep.scanBefore,
  };
}
export type SweepStep = ReturnType<typeof stepFor>;

/** Make sure the owner has a sweep and that it is scheduled. Runs when
 * Convex becomes the owner's writer (owners.setWriter): the first sweep is
 * due at once, to find what the handoff may have missed. */
export const start = internalMutation({
  args: { owner: v.id('owners') },
  handler: async (ctx, { owner }) => {
    if (!ingests(await ctx.db.get('owners', owner))) return;
    const now = Date.now();
    const sweep = await sweepFor(ctx, owner);
    if (sweep) {
      if (!sweep.lease || sweep.lease.expiresAt <= now)
        await schedule(ctx, owner, Math.max(now, sweep.dueAt));
      return;
    }
    await ctx.db.insert('ingestionSweeps', {
      owner,
      number: 0,
      phase: 'idle',
      dueAt: now,
      scanBefore: 0,
      page: 1,
      after: '',
      attempt: 0,
      claims: 0,
    });
    await schedule(ctx, owner, now);
  },
});

/** Take a due sweep, starting a new one when the last has finished. */
export const claim = internalMutation({
  args: { owner: v.id('owners') },
  handler: async (ctx, args): Promise<SweepStep | null> => {
    const now = Date.now();
    const sweep = await sweepFor(ctx, args.owner);
    if (!sweep || sweep.dueAt > now || (sweep.lease?.expiresAt ?? 0) > now)
      return null;
    const owner = await ctx.db.get('owners', args.owner);
    if (!ingests(owner)) return null;
    const number = sweep.claims + 1;
    const next =
      sweep.phase === 'idle'
        ? {
            number: sweep.number + 1,
            phase: 'scanning' as const,
            page: 1,
            scanBefore: Math.floor(now / 1000),
            after: '',
          }
        : {};
    const lease = { claim: number, expiresAt: now + LEASE_MS };
    await ctx.db.patch('ingestionSweeps', sweep._id, {
      ...next,
      claims: number,
      lease,
    });
    await ctx.scheduler.runAt(
      lease.expiresAt,
      internal.ingestionSweep.recover,
      { owner: args.owner, claim: number },
    );
    return stepFor(owner, number, { ...sweep, ...next });
  },
});

/** Record one page of the provider's list and ask for what differs. An
 * empty page ends the scan. Returns the next step, or null when the claim
 * no longer holds the sweep. */
export const applyPage = internalMutation({
  args: {
    owner: v.id('owners'),
    claim: v.number(),
    page: v.number(),
    items: v.array(
      v.object({
        id: v.string(),
        fingerprint: v.string(),
        fields: v.object(summaryFields),
      }),
    ),
  },
  handler: async (ctx, args): Promise<SweepStep | null> => {
    const holder = await held(ctx, args.owner, args.claim);
    if (!holder || holder.sweep.phase !== 'scanning') return null;
    const { sweep, owner } = holder;
    // Checked here as well as in the job: a handed-off owner's fingerprints
    // must not move while nothing can act on them.
    if (!ingests(owner)) throw new Error('Activity owner unavailable');
    if (args.page !== sweep.page || args.items.length > SWEEP_PAGE_SIZE)
      throw new Error('Unexpected sweep page');
    for (const { id, fingerprint, fields } of args.items) {
      const activity = idKey(id);
      const [job, row] = await Promise.all([
        jobFor(ctx, owner._id, activity),
        activityFor(ctx, owner._id, activity),
      ]);
      const dto =
        row && !row.deleted && row.generation === owner.generation
          ? row.dto
          : undefined;
      let wanted: boolean;
      if (job?.status === 'blocked' || job?.status === 'failed') wanted = true;
      else if (job?.summary !== undefined) wanted = job.summary !== fingerprint;
      else
        wanted =
          !dto ||
          Object.entries(fields).some(
            ([field, value]) =>
              JSON.stringify(dto[field as keyof typeof fields]) !==
              JSON.stringify(value),
          );
      const mark = { summary: fingerprint, seen: sweep.number };
      if (wanted)
        await ctx.db.patch(
          'ingestionJobs',
          await requestIngestion(ctx, owner._id, activity),
          mark,
        );
      else if (job) await ctx.db.patch('ingestionJobs', job._id, mark);
      else
        await ctx.db.insert('ingestionJobs', {
          owner: owner._id,
          activity,
          status: 'idle',
          phase: 'source',
          requested: 0,
          attempt: 0,
          revision: 0,
          claims: 0,
          ...mark,
        });
    }
    const next =
      args.items.length === 0
        ? { phase: 'confirming' as const, after: '' }
        : { page: sweep.page + 1 };
    await extend(ctx, sweep, args.claim, next);
    return stepFor(owner, args.claim, { ...sweep, ...next });
  },
});

/** Ask for activities the scan did not see, a bounded number at a time,
 * and finish the sweep when the whole library has been looked at. */
export const confirm = internalMutation({
  args: { owner: v.id('owners'), claim: v.number() },
  handler: async (ctx, args) => {
    const holder = await held(ctx, args.owner, args.claim);
    if (!holder || holder.sweep.phase !== 'confirming') return;
    const { sweep, owner } = holder;
    if (!ingests(owner)) throw new Error('Activity owner unavailable');
    const now = Date.now();
    const rows = await ctx.db
      .query('activities')
      .withIndex('by_owner_live_key', (q) =>
        q
          .eq('owner', owner._id)
          .eq('generation', owner.generation)
          .eq('deleted', false)
          .gt('key', sweep.after),
      )
      .take(CONFIRM_PAGE);
    let asked = 0;
    let after = sweep.after;
    for (const row of rows) {
      if (asked >= CONFIRM_LIMIT) break;
      after = row.key;
      // The list ended at the sweep's start: anything newer was not in it.
      if (
        !row.dto ||
        new Date(row.dto.start_date).getTime() >= sweep.scanBefore * 1000
      )
        continue;
      const job = await jobFor(ctx, owner._id, row.key);
      if (job?.seen === sweep.number) continue;
      await ctx.db.patch(
        'ingestionJobs',
        await requestIngestion(ctx, owner._id, row.key),
        { seen: sweep.number, summary: undefined },
      );
      asked++;
    }
    if (asked >= CONFIRM_LIMIT)
      return release(ctx, sweep, now + CONFIRM_INTERVAL_MS, { after });
    if (rows.length === CONFIRM_PAGE)
      return release(ctx, sweep, now, { after });
    await release(ctx, sweep, now + SWEEP_INTERVAL_MS, {
      phase: 'idle',
      after: '',
      completedAt: now,
    });
  },
});

/** End a run that did not finish, or that has used its time (`yield`). */
export const fail = internalMutation({
  args: {
    owner: v.id('owners'),
    claim: v.number(),
    failure: v.union(
      v.object({ kind: v.literal('yield') }),
      v.object({
        kind: v.literal('rate_limited'),
        retryAfterSeconds: v.number(),
      }),
      v.object({ kind: v.literal('blocked'), reason: v.string() }),
      v.object({ kind: v.literal('retry'), reason: v.string() }),
    ),
  },
  handler: async (ctx, { failure, ...args }) => {
    const holder = await held(ctx, args.owner, args.claim);
    if (!holder) return;
    const { sweep, owner } = holder;
    const now = Date.now();
    if (!ingests(owner)) {
      // Handed off while under way; `start` schedules it again.
      await ctx.db.patch('ingestionSweeps', sweep._id, {
        lease: undefined,
        dueAt: now,
        error: 'fenced',
      });
      return;
    }
    switch (failure.kind) {
      case 'yield':
        return release(ctx, sweep, now);
      case 'rate_limited':
        return release(
          ctx,
          sweep,
          now + Math.max(1, Math.ceil(failure.retryAfterSeconds)) * 1000,
          { error: 'rate_limited' },
        );
      case 'blocked':
        return release(ctx, sweep, now + BLOCKED_RETRY_MS, {
          error: failure.reason.slice(0, 200),
        });
      case 'retry': {
        const attempt = sweep.attempt + 1;
        return release(ctx, sweep, now + retryDelayMs(attempt), {
          attempt,
          error: failure.reason.slice(0, 200),
        });
      }
    }
  },
});

/** Scheduled for the end of every lease: retry a run that was lost. */
export const recover = internalMutation({
  args: { owner: v.id('owners'), claim: v.number() },
  handler: async (ctx, args) => {
    const holder = await held(ctx, args.owner, args.claim);
    const now = Date.now();
    if (!holder || holder.sweep.lease!.expiresAt > now) return;
    const { sweep, owner } = holder;
    if (!ingests(owner)) {
      await ctx.db.patch('ingestionSweeps', sweep._id, {
        lease: undefined,
        dueAt: now,
        error: 'fenced',
      });
      return;
    }
    const attempt = sweep.attempt + 1;
    await release(ctx, sweep, now + retryDelayMs(attempt), {
      attempt,
      error: 'lease_expired',
    });
  },
});

/** The owner's sweep, for an operator:
 * `convex run ingestionSweep:status '{"userId":"<userId>"}'`. */
export const status = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const owner = await ownerFor(ctx, userId);
    const sweep = owner && (await sweepFor(ctx, owner._id));
    if (!sweep) return null;
    return {
      number: sweep.number,
      phase: sweep.phase,
      page: sweep.page,
      dueAt: sweep.dueAt,
      running: !!sweep.lease && sweep.lease.expiresAt > Date.now(),
      attempt: sweep.attempt,
      error: sweep.error ?? null,
      completedAt: sweep.completedAt ?? null,
    };
  },
});
