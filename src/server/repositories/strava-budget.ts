import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db } from '~/server/db';
import { stravaRequestBudgets } from '~/server/db/schema';
import {
  StravaBudgetExceededError,
  STRAVA_RATE_LIMIT_15_MINUTE_RESERVE,
  STRAVA_RATE_LIMIT_DAILY_RESERVE,
  type StravaRequestBudget,
} from '~/server/strava/request-budget';

const WINDOWS = [
  {
    key: 'overall:15m',
    group: 'overall',
    duration: 900_000,
    ceiling: 200,
    reserve: STRAVA_RATE_LIMIT_15_MINUTE_RESERVE,
  },
  {
    key: 'overall:day',
    group: 'overall',
    duration: 86_400_000,
    ceiling: 2000,
    reserve: STRAVA_RATE_LIMIT_DAILY_RESERVE,
  },
  {
    key: 'read:15m',
    group: 'read',
    duration: 900_000,
    ceiling: 100,
    reserve: STRAVA_RATE_LIMIT_15_MINUTE_RESERVE,
  },
  {
    key: 'read:day',
    group: 'read',
    duration: 86_400_000,
    ceiling: 1000,
    reserve: STRAVA_RATE_LIMIT_DAILY_RESERVE,
  },
] as const;
const startOf = (now: Date, duration: number) =>
  new Date(Math.floor(now.getTime() / duration) * duration);

export function createStravaRequestBudget(
  database: typeof db = db,
  clock = () => new Date(),
): StravaRequestBudget {
  return {
    async reserve(read) {
      let startedAt: Date;
      // A single short global lock keeps reservations of all four windows
      // atomic across processes. Never held while an HTTP request is in flight.
      await database.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(183, 1)`);
        // Resolve the window after waiting for the lock, never roll a newer
        // reservation back to the previous window with a pre-wait timestamp.
        startedAt = clock();
        for (const window of WINDOWS.filter(
          (w) => read || w.group === 'overall',
        )) {
          const windowStart = startOf(startedAt, window.duration);
          const [previous] = await tx
            .select()
            .from(stravaRequestBudgets)
            .where(eq(stravaRequestBudgets.key, window.key));
          const sameWindow =
            previous?.windowStart.getTime() === windowStart.getTime();
          const used = sameWindow ? previous.used : 0;
          const inFlight = sameWindow ? previous.inFlight : 0;
          // An observed lower app-specific ceiling survives window rollover.
          const ceiling = previous?.ceiling ?? window.ceiling;
          const blockedUntil = previous?.blockedUntil;
          const reset = windowStart.getTime() + window.duration;
          if (
            (blockedUntil && blockedUntil > startedAt) ||
            used >= Math.max(0, ceiling - window.reserve)
          ) {
            throw new StravaBudgetExceededError(
              Math.max(
                1,
                Math.ceil(
                  ((blockedUntil && blockedUntil > startedAt
                    ? blockedUntil.getTime()
                    : reset) -
                    startedAt.getTime()) /
                    1000,
                ),
              ),
            );
          }
          await tx
            .insert(stravaRequestBudgets)
            .values({
              key: window.key,
              windowStart,
              used: used + 1,
              inFlight: inFlight + 1,
              ceiling,
            })
            .onConflictDoUpdate({
              target: stravaRequestBudgets.key,
              set: {
                windowStart,
                used: used + 1,
                inFlight: inFlight + 1,
                blockedUntil: null,
              },
            });
        }
      });
      return { startedAt: startedAt!, read };
    },
    async observe(ticket, usage, status) {
      await database.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(183, 1)`);
        for (const window of WINDOWS.filter(
          (w) => ticket.read || w.group === 'overall',
        )) {
          const [row] = await tx
            .select()
            .from(stravaRequestBudgets)
            .where(eq(stravaRequestBudgets.key, window.key));
          // A late response must never assign old-window usage to a new window.
          if (
            row?.windowStart.getTime() !==
            startOf(ticket.startedAt, window.duration).getTime()
          )
            continue;
          const report = usage?.[window.group];
          const observed =
            window.duration === 900_000
              ? report?.usage15Minutes
              : report?.usageDaily;
          const ceiling =
            window.duration === 900_000
              ? report?.limit15Minutes
              : report?.limitDaily;
          const exhausted =
            observed !== undefined &&
            ceiling !== undefined &&
            observed >= ceiling - window.reserve;
          // With no useful headers, a 429 closes the 15m window; a reported
          // exhausted daily window remains closed until midnight UTC.
          const block =
            exhausted || (status === 429 && window.duration === 900_000);
          await tx
            .update(stravaRequestBudgets)
            .set({
              used: Math.max(
                row.used,
                (observed ?? 0) + Math.max(0, row.inFlight - 1),
              ),
              inFlight: Math.max(0, row.inFlight - 1),
              ceiling: ceiling ?? row.ceiling,
              blockedUntil: block
                ? new Date(row.windowStart.getTime() + window.duration)
                : row.blockedUntil,
            })
            .where(eq(stravaRequestBudgets.key, window.key));
        }
      });
    },
  };
}
export const stravaRequestBudget = createStravaRequestBudget();
