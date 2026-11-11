import type { RateLimitRepository } from '~/server/repositories/rate-limit';
import {
  StravaBudgetBusyError,
  StravaBudgetExceededError,
  type StravaRequestBudget,
} from '~/server/strava/request-budget';

import { convexAuthStore } from './convex-adapter';

/**
 * The app's rate limit counters and the provider's shared request budget,
 * kept in Convex (backend/convex/appState.ts) instead of Postgres. Same
 * interfaces as the Postgres repositories, so callers do not change.
 */

type Call = ReturnType<typeof convexAuthStore>;

export function convexRateLimitRepository(
  call: Call = convexAuthStore(),
): RateLimitRepository {
  return {
    incrementAndGet: (key, windowStart) =>
      call<number>({
        kind: 'rateLimit',
        key,
        windowStart: windowStart.getTime(),
      }),
    deleteWindowsBefore: (cutoff) =>
      call<number>({ kind: 'expireRateLimits', cutoff: cutoff.getTime() }),
  };
}

export function convexStravaRequestBudget(
  reserves?: { fifteenMinutes: number; daily: number; maxInFlight?: number },
  call: Call = convexAuthStore(),
): StravaRequestBudget {
  return {
    async reserve(read) {
      const result = await call<
        | { ok: true; startedAt: number }
        | { ok: false; busy: boolean; retryAfterSeconds: number }
      >({ kind: 'budgetReserve', read, ...reserves });
      if (result.ok) return { startedAt: new Date(result.startedAt), read };
      throw result.busy
        ? new StravaBudgetBusyError()
        : new StravaBudgetExceededError(result.retryAfterSeconds);
    },
    async observe(ticket, usage, status) {
      await call({
        kind: 'budgetObserve',
        startedAt: ticket.startedAt.getTime(),
        read: ticket.read,
        ...(usage && { usage }),
        status,
      });
    },
  };
}
