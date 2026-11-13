import type { RateLimitRepository } from '~/server/repositories/rate-limit';
import {
  StravaBudgetBusyError,
  StravaBudgetExceededError,
  type StravaRequestBudget,
} from '~/server/strava/request-budget';
import { warnBridgeFallback } from '~/server/sync/bridge-fallback-warning';
import { BridgeResponseError } from '~/server/sync/bridge-response-error';

import { convexAuthStore } from './convex-adapter';

/**
 * The app's rate limit counters and the provider's shared request budget,
 * kept in Convex (backend/convex/appState.ts) behind the shared repository
 * interfaces used by API boundaries and provider calls.
 */

type Call = ReturnType<typeof convexAuthStore>;

export function convexRateLimitRepository(
  call: Call = convexAuthStore(),
): RateLimitRepository {
  return {
    incrementManyAndGet: async (windows) => {
      try {
        return await call<number[]>({ kind: 'rateLimits', windows });
      } catch (error) {
        // The previous auth bridge rejects unknown operations with 400. Keep
        // enforcing the SAME ordered buckets until the backend is upgraded.
        if (!(error instanceof BridgeResponseError) || error.status !== 400)
          throw error;
        warnBridgeFallback('rateLimits');
        const counts: number[] = [];
        for (const { key, windowStart, limit } of windows) {
          const count = await call<number>({
            kind: 'rateLimit',
            key,
            windowStart,
          });
          counts.push(count);
          if (count > limit) break;
        }
        return counts;
      }
    },
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
