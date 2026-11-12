import 'server-only';

import { convexRateLimitRepository } from '~/server/auth/convex-app-state';

/**
 * The fixed-window request counters behind the v1 rate limits
 * (`~/server/http/rate-limit.ts`). Application code depends on this
 * interface, so it can be tested against an in-memory fake.
 */
export interface RateLimitRepository {
  /**
   * Atomically increments the counter for `(key, windowStart)` - creating
   * the row at `count: 1` if this is the first request in that window - and
   * returns the resulting count. Concurrent callers for the same key/window
   * are serialized by the store, so two requests
   * racing at a window boundary can never both read a stale pre-increment
   * count.
   */
  incrementAndGet(key: string, windowStart: Date): Promise<number>;
  /** Ordered checks in one transaction; stops after the first exhausted bucket. */
  incrementManyAndGet?(
    windows: { key: string; windowStart: number; limit: number }[],
  ): Promise<number[]>;

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

/** The counters, kept in Convex (`backend/convex/appState.ts`). */
export const rateLimitRepository = convexRateLimitRepository();
