import type { MutationCtx } from '../_generated/server';

// Mirrors the existing production reserves. The fixture ledger has no live
// rate-limit headers or connection to the production provider application.
const shortReserve = 25;
const dayReserve = 100;
const short = 900_000;
const day = 86_400_000;
const windows = [
  {
    key: 'overall:15m',
    duration: short,
    limit: 200 - shortReserve,
    read: false,
  },
  { key: 'overall:day', duration: day, limit: 2000 - dayReserve, read: false },
  { key: 'read:15m', duration: short, limit: 100 - shortReserve, read: true },
  { key: 'read:day', duration: day, limit: 1000 - dayReserve, read: true },
];

function windowRow(ctx: MutationCtx, app: string, window: string) {
  return ctx.db
    .query('ingestionBudgets')
    .withIndex('app_window', (q) => q.eq('app', app).eq('window', window))
    .unique();
}

export async function reserve(
  ctx: MutationCtx,
  app: string,
  read: boolean,
  now: number,
) {
  const rows = [];
  let retryAt = now;
  for (const window of windows) {
    if (window.read && !read) continue;
    const row = await windowRow(ctx, app, window.key);
    const start = Math.floor(now / window.duration) * window.duration;
    const used = row?.start === start ? row.used : 0;
    retryAt = Math.max(retryAt, row?.blockedUntil ?? 0);
    if (used >= window.limit)
      retryAt = Math.max(retryAt, start + window.duration);
    rows.push({ window: window.key, row, start, used });
  }
  if (retryAt > now) return retryAt;
  // Even an interrupted request conservatively spends its reservation.
  for (const { window, row, start, used } of rows) {
    if (row)
      await ctx.db.patch('ingestionBudgets', row._id, {
        start,
        used: used + 1,
      });
    else
      await ctx.db.insert('ingestionBudgets', {
        app,
        window,
        start,
        used: used + 1,
      });
  }
  return null;
}

export async function recordRateLimit(
  ctx: MutationCtx,
  app: string,
  startedAt: number,
  retryAfterMs?: number,
) {
  const start = Math.floor(startedAt / short) * short;
  const retryAt =
    retryAfterMs === undefined ? start + short : Date.now() + retryAfterMs;
  const row = await windowRow(ctx, app, 'overall:15m');
  // A late response without Retry-After must not close a newer quota window.
  if (row && (row.start === start || retryAfterMs !== undefined)) {
    await ctx.db.patch('ingestionBudgets', row._id, {
      blockedUntil: Math.max(row.blockedUntil ?? 0, retryAt),
    });
  }
  return Math.max(retryAt, row?.blockedUntil ?? 0);
}
