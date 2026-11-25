import { v } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import { type QueryCtx, internalQuery } from './_generated/server';
import { ingests } from './ingestion';

/**
 * What the app's operator dashboard (`/admin`) reads, through the signed
 * admin route (convex/http.ts). Counts, states and times only: no names,
 * email addresses, activity IDs, locations or tiles leave this file, and
 * `src/server/admin/contract.ts` refuses an answer with other fields.
 *
 * Every figure is a stored row or a bounded index read; nothing scans a
 * library.
 */

const USER_PAGE = 16;
/** Jobs read per user and status; a count at the limit means "or more". */
const JOB_LIMIT = 250;
const TILE_LIMIT = 1000;

/** Job errors are partly free text from caught exceptions. Only these leave
 * the backend, the rest as `other`; the text stays with the job. */
const ERROR_CODES: Record<string, string> = {
  rate_limited: 'rate_limited',
  lease_expired: 'lease_expired',
  fenced: 'fenced',
  foreign_activity: 'foreign_activity',
  invalid_response: 'invalid_response',
  not_found: 'not_found',
  forbidden: 'forbidden',
  credentials_rejected: 'credentials_rejected',
  'The provider gateway is not configured': 'gateway_not_configured',
  'Tile budget exceeded: result incomplete': 'tile_budget',
};
function errorCode(error: string | undefined) {
  if (error === undefined) return null;
  if (Object.hasOwn(ERROR_CODES, error)) return ERROR_CODES[error]!;
  return error.startsWith('upstream_error') ? 'upstream_error' : 'other';
}

/** The figures that belong to no user. */
export const overview = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [state, budget, event] = await Promise.all([
      ctx.db.query('placeCatalogueState').unique(),
      ctx.db.query('providerBudget').take(8),
      ctx.db
        .query('providerEvents')
        .withIndex('by_received')
        .order('desc')
        .first(),
    ]);
    // Tiles of a pending revision wait for its completion.
    const tiles = state
      ? await ctx.db
          .query('placeTileChanges')
          .withIndex('by_revision_tile', (q) =>
            q.lte('revision', state.revision),
          )
          .take(TILE_LIMIT)
      : [];
    return {
      observedAt: now,
      lastEventAt: event?.receivedAt ?? null,
      catalogue: state && {
        revision: state.revision,
        places: state.count,
        pending: state.pending
          ? {
              revision: state.pending.revision,
              startedAt: state.pending.startedAt,
            }
          : null,
        /** Changed tiles the re-match walk has not finished. */
        tilesLeft: { count: tiles.length, capped: tiles.length === TILE_LIMIT },
      },
      budget: budget.map(
        ({ key, windowStart, used, ceiling, blockedUntil }) => ({
          key,
          windowStart,
          used,
          limit: ceiling,
          blockedUntil: blockedUntil ?? null,
        }),
      ),
    };
  },
});

function jobsOf(
  ctx: QueryCtx,
  owner: Doc<'owners'>,
  status: 'queued' | 'failed' | 'blocked',
) {
  return ctx.db
    .query('ingestionJobs')
    .withIndex('by_owner_status', (q) =>
      q.eq('owner', owner._id).eq('status', status),
    )
    .take(JOB_LIMIT);
}

const timeOf = (value: unknown) => {
  const time =
    typeof value === 'string' || typeof value === 'number'
      ? new Date(value).getTime()
      : NaN;
  return Number.isFinite(time) ? time : null;
};

/** Whether anyone can sign in to the library, and when Strava access was
 * withdrawn and the erasure is due, from the sign-in record. Nothing else of
 * it is read out. */
async function access(ctx: QueryCtx, userId: string) {
  const accounts = await ctx.db
    .query('authRecords')
    .withIndex('by_model_userId', (q) =>
      q.eq('model', 'account').eq('userId', userId),
    )
    .take(8);
  const account = accounts
    .map((record) => record.doc as Record<string, unknown>)
    .find((doc) => doc.providerId === 'strava');
  return {
    hasAccount: accounts.length > 0,
    revokedAt: timeOf(account?.revokedAt),
    erasureDueAt: timeOf(account?.scheduledErasureAt),
  };
}

async function userFigures(ctx: QueryCtx, owner: Doc<'owners'>, now: number) {
  const [stats, sweep, event, queued, failed, blocked, accountAccess] =
    await Promise.all([
      ctx.db
        .query('ownerStats')
        .withIndex('by_owner', (q) => q.eq('owner', owner._id))
        .unique(),
      ctx.db
        .query('ingestionSweeps')
        .withIndex('by_owner', (q) => q.eq('owner', owner._id))
        .unique(),
      ctx.db
        .query('providerEvents')
        .withIndex('by_owner_received', (q) => q.eq('owner', owner._id))
        .order('desc')
        .first(),
      jobsOf(ctx, owner, 'queued'),
      jobsOf(ctx, owner, 'failed'),
      jobsOf(ctx, owner, 'blocked'),
      access(ctx, owner.userId),
    ]);
  const counts = stats?.counts;
  const split = (jobs: Doc<'ingestionJobs'>[]) => {
    const matches = jobs.filter((job) => job.phase === 'match').length;
    return {
      activities: jobs.length - matches,
      matches,
      capped: jobs.length === JOB_LIMIT,
    };
  };
  const reasons = new Map<
    string,
    { stage: 'activities' | 'matches'; code: string; count: number }
  >();
  for (const job of [...failed, ...blocked]) {
    const stage = job.phase === 'match' ? 'matches' : 'activities';
    const code = errorCode(job.error) ?? 'other';
    const key = `${stage} ${code}`;
    const reason = reasons.get(key);
    if (reason) reason.count++;
    else reasons.set(key, { stage, code, count: 1 });
  }
  return {
    athleteId: owner.athleteId,
    createdAt: owner._creationTime,
    /** Whether Convex ingests for the user now. */
    active: ingests(owner),
    ...accountAccess,
    /** Null until the counts exist; not final while they are rebuilt. */
    counts: counts
      ? {
          activities: counts.total,
          recordings: counts.withData + counts.withoutData,
          photos: counts.photoCount,
          /** Activities that still miss their details or their recording. */
          toFetch: Math.max(
            counts.neverFetched + counts.invalidatedDetails,
            counts.runnable + counts.waiting + counts.blocked,
          ),
          rebuilding: stats.rebuildAfter !== undefined,
        }
      : null,
    lastEventAt: event?.receivedAt ?? null,
    sweep: sweep && {
      phase: sweep.phase,
      dueAt: sweep.dueAt,
      running: (sweep.lease?.expiresAt ?? 0) > now,
      error: errorCode(sweep.error),
      /** `completedAt` for a sweep that finished before `listReadAt` was
       * recorded. */
      listReadAt: sweep.listReadAt ?? sweep.completedAt ?? null,
    },
    jobs: {
      queued: split(queued),
      failed: split(failed),
      blocked: split(blocked),
      reasons: [...reasons.values()],
      /** The earliest due time of a queued job that no run holds. */
      oldestDueAt: queued.reduce<number | null>(
        (oldest, job) =>
          job.dueAt === undefined || (job.lease?.expiresAt ?? 0) > now
            ? oldest
            : Math.min(oldest ?? job.dueAt, job.dueAt),
        null,
      ),
    },
  };
}

/** One page of users, in the order they were created. */
export const users = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const now = Date.now();
    const page = await ctx.db
      .query('owners')
      .paginate({ numItems: USER_PAGE, cursor });
    return {
      page: await Promise.all(
        page.page.map((owner) => userFigures(ctx, owner, now)),
      ),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});
