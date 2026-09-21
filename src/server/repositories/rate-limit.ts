import 'server-only';

import { lt, sql } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import { apiRateLimitBuckets } from '~/server/db/schema';

type DrizzleDb = typeof defaultDb;

/**
 * Repository boundary for the `api_rate_limit_bucket` fixed-window counter
 * table (issue #127), the same pattern as `~/server/repositories/changes.ts`
 * and friends: application code (here, `~/server/http/rate-limit.ts`'s
 * `evaluateRateLimit`) depends on this interface rather than on Drizzle
 * directly, so it can be tested against an in-memory fake instead of a live
 * database.
 */
export interface RateLimitRepository {
  /**
   * Atomically increments the counter for `(key, windowStart)` - creating
   * the row at `count: 1` if this is the first request in that window - and
   * returns the resulting count. Concurrent callers for the same key/window
   * are serialized by Postgres's `ON CONFLICT` upsert, so two requests
   * racing at a window boundary can never both read a stale pre-increment
   * count.
   */
  incrementAndGet(key: string, windowStart: Date): Promise<number>;

  /**
   * Deletes bucket rows whose window started before `cutoff`. Every window
   * is fixed-length and rate-limit decisions only ever compare a request's
   * own timestamp against its own window, so a row can be deleted once its
   * window has fully elapsed with no risk of resurrecting a stale count for
   * a still-in-flight request. Used by the periodic
   * `/api/cron/cleanup-rate-limits` job; nothing in a request path calls
   * this.
   */
  deleteWindowsBefore(cutoff: Date): Promise<number>;
}

export function createRateLimitRepository(
  database: DrizzleDb = defaultDb,
): RateLimitRepository {
  return {
    async incrementAndGet(key, windowStart) {
      const [row] = await database
        .insert(apiRateLimitBuckets)
        .values({ key, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [apiRateLimitBuckets.key, apiRateLimitBuckets.windowStart],
          set: {
            count: sql`${apiRateLimitBuckets.count} + 1`,
            updatedAt: new Date(),
          },
        })
        .returning({ count: apiRateLimitBuckets.count });
      // The upsert always returns exactly one row; the fallback only
      // satisfies the type checker.
      return row?.count ?? 1;
    },

    async deleteWindowsBefore(cutoff) {
      const deleted = await database
        .delete(apiRateLimitBuckets)
        .where(lt(apiRateLimitBuckets.windowStart, cutoff))
        .returning({ key: apiRateLimitBuckets.key });
      return deleted.length;
    },
  };
}

/** Default, database-backed repository used by application services. */
export const rateLimitRepository = createRateLimitRepository();
