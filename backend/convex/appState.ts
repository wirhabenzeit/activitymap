import { v } from 'convex/values';

import { internal } from './_generated/api';
import { type MutationCtx, internalMutation } from './_generated/server';

/**
 * Two counters the app keeps for itself, held here instead of in Postgres:
 * the per-caller request counters behind its API rate limit, and the shared
 * request budget for the provider. Both are small, and both must be exact
 * under concurrent requests, which a mutation is.
 *
 * Only the app reaches these, through the signed auth route (http.ts).
 */

const PAGE = 256;

/** Count one request in the fixed window `(key, windowStart)`; the new
 * count. */
async function increment(
  ctx: MutationCtx,
  key: string,
  windowStart: number,
): Promise<number> {
  if (!key || key.length > 512 || !Number.isSafeInteger(windowStart))
    throw new Error('Invalid rate limit window');
  const row = await ctx.db
    .query('rateLimits')
    .withIndex('by_key_window', (q) =>
      q.eq('key', key).eq('windowStart', windowStart),
    )
    .unique();
  if (!row) {
    await ctx.db.insert('rateLimits', { key, windowStart, count: 1 });
    return 1;
  }
  await ctx.db.patch('rateLimits', row._id, { count: row.count + 1 });
  return row.count + 1;
}

export const hit = internalMutation({
  args: { key: v.string(), windowStart: v.number() },
  handler: (ctx, { key, windowStart }) => increment(ctx, key, windowStart),
});

export const hitMany = internalMutation({
  args: {
    windows: v.array(
      v.object({ key: v.string(), windowStart: v.number(), limit: v.number() }),
    ),
  },
  handler: async (ctx, { windows }) => {
    if (windows.length > 4) throw new Error('Too many rate limit windows');
    const counts: number[] = [];
    for (const { key, windowStart, limit } of windows) {
      if (!Number.isSafeInteger(limit) || limit < 0)
        throw new Error('Invalid rate limit');
      const count = await increment(ctx, key, windowStart);
      counts.push(count);
      if (count > limit) break;
    }
    return counts;
  },
});

/** Delete windows that started before `cutoff`; how many. A window is never
 * read again once it has elapsed. */
export const expireRateLimits = internalMutation({
  args: { cutoff: v.number() },
  handler: async (ctx, { cutoff }): Promise<number> => {
    const rows = await ctx.db
      .query('rateLimits')
      .withIndex('by_window', (q) => q.lt('windowStart', cutoff))
      .take(PAGE);
    for (const row of rows) await ctx.db.delete('rateLimits', row._id);
    if (rows.length === PAGE)
      await ctx.scheduler.runAfter(0, internal.appState.expireRateLimits, {
        cutoff,
      });
    return rows.length;
  },
});

/** Daily: windows are at most a day long. */
export const expireOldRateLimits = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    await ctx.scheduler.runAfter(0, internal.appState.expireRateLimits, {
      cutoff: Date.now() - 2 * 86_400_000,
    });
  },
});

/**
 * The provider's request budget, shared by every account: a quarter-hour
 * and a daily window, for all requests and for reads. A request reserves
 * from each window that applies before it is sent and reports what the
 * provider said afterwards. The rules are the ones the Postgres ledger
 * applied (src/server/repositories/strava-budget.ts).
 */
const WINDOWS = [
  { key: 'overall:15m', group: 'overall', duration: 900_000, ceiling: 200 },
  { key: 'overall:day', group: 'overall', duration: 86_400_000, ceiling: 2000 },
  { key: 'read:15m', group: 'read', duration: 900_000, ceiling: 100 },
  { key: 'read:day', group: 'read', duration: 86_400_000, ceiling: 1000 },
] as const;
const RESERVE_15_MINUTES = 25;
const RESERVE_DAILY = 100;
const reserveOf = (duration: number) =>
  duration === 900_000 ? RESERVE_15_MINUTES : RESERVE_DAILY;
const startOf = (now: number, duration: number) =>
  Math.floor(now / duration) * duration;

/** Reserve one request. Answers when it was reserved, or why not: the
 * budget is used up (with the seconds to wait) or too many requests are in
 * flight. Nothing is reserved unless every window has room. */
export const reserve = internalMutation({
  args: {
    read: v.boolean(),
    fifteenMinutes: v.optional(v.number()),
    daily: v.optional(v.number()),
    maxInFlight: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; startedAt: number }
    | { ok: false; busy: boolean; retryAfterSeconds: number }
  > => {
    const startedAt = Date.now();
    const windows = WINDOWS.filter((w) => args.read || w.group === 'overall');
    const next = [];
    for (const window of windows) {
      const windowStart = startOf(startedAt, window.duration);
      const previous = await ctx.db
        .query('providerBudget')
        .withIndex('by_key', (q) => q.eq('key', window.key))
        .unique();
      const sameWindow = previous?.windowStart === windowStart;
      const used = sameWindow ? previous.used : 0;
      const inFlight = sameWindow ? previous.inFlight : 0;
      const ceiling = previous?.ceiling ?? window.ceiling;
      const blockedUntil = previous?.blockedUntil;
      if (
        window.key === 'overall:15m' &&
        args.maxInFlight !== undefined &&
        inFlight >= args.maxInFlight
      )
        return { ok: false, busy: true, retryAfterSeconds: 30 };
      const held = Math.max(
        reserveOf(window.duration),
        (window.duration === 900_000 ? args.fifteenMinutes : args.daily) ?? 0,
      );
      const blocked = blockedUntil !== undefined && blockedUntil > startedAt;
      if (blocked || used >= Math.max(0, ceiling - held))
        return {
          ok: false,
          busy: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(
              ((blocked ? blockedUntil : windowStart + window.duration) -
                startedAt) /
                1000,
            ),
          ),
        };
      next.push({
        previous,
        row: {
          key: window.key,
          windowStart,
          used: used + 1,
          inFlight: inFlight + 1,
          ceiling,
        },
      });
    }
    for (const { previous, row } of next)
      if (previous) await ctx.db.replace('providerBudget', previous._id, row);
      else await ctx.db.insert('providerBudget', row);
    return { ok: true, startedAt };
  },
});

const usage = v.optional(
  v.object({
    limit15Minutes: v.optional(v.number()),
    limitDaily: v.optional(v.number()),
    usage15Minutes: v.optional(v.number()),
    usageDaily: v.optional(v.number()),
  }),
);

/** Report a finished request: what the provider says has been used, and
 * whether it refused. */
export const observe = internalMutation({
  args: {
    startedAt: v.number(),
    read: v.boolean(),
    usage: v.optional(v.object({ overall: usage, read: usage })),
    status: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    for (const window of WINDOWS.filter(
      (w) => args.read || w.group === 'overall',
    )) {
      const row = await ctx.db
        .query('providerBudget')
        .withIndex('by_key', (q) => q.eq('key', window.key))
        .unique();
      if (row?.windowStart !== startOf(args.startedAt, window.duration))
        continue;
      const report = args.usage?.[window.group];
      const short = window.duration === 900_000;
      const observed = short ? report?.usage15Minutes : report?.usageDaily;
      const ceiling = short ? report?.limit15Minutes : report?.limitDaily;
      const exhausted =
        observed !== undefined &&
        ceiling !== undefined &&
        observed >= ceiling - reserveOf(window.duration);
      const block = exhausted || (args.status === 429 && short);
      await ctx.db.patch('providerBudget', row._id, {
        used: Math.max(
          row.used,
          (observed ?? 0) + Math.max(0, row.inFlight - 1),
        ),
        inFlight: Math.max(0, row.inFlight - 1),
        ceiling: ceiling ?? row.ceiling,
        ...(block && { blockedUntil: row.windowStart + window.duration }),
      });
    }
  },
});
