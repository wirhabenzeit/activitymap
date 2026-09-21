import { errorEnvelope } from '~/contracts/v1/error';
import { logger } from '~/server/logging/logger';
import {
  evaluateRateLimit,
  ipKeyFor,
  sessionKeyFor,
  type RateLimitRule,
  userKeyFor,
} from '~/server/http/rate-limit';
import { requestIdFor } from '~/server/http/request-id';
import {
  rateLimitRepository,
  type RateLimitRepository,
} from '~/server/repositories/rate-limit';

export type { RateLimitRule };

/** Generous default: a native client can legitimately poll `/api/v1/sync/*` fairly often. */
export const DEFAULT_SESSION_RATE_LIMIT: RateLimitRule = {
  limit: 300,
  windowMs: 5 * 60 * 1000,
};
/** Aggregates traffic across all sessions and devices for one authenticated user. */
export const DEFAULT_USER_RATE_LIMIT: RateLimitRule = {
  limit: 600,
  windowMs: 5 * 60 * 1000,
};
/** Applied everywhere as a floor alongside the per-session limit. */
export const DEFAULT_IP_RATE_LIMIT: RateLimitRule = {
  limit: 600,
  windowMs: 5 * 60 * 1000,
};
/** For pre-auth, higher-risk endpoints (OAuth start/exchange) where IP is the only signal. */
export const STRICT_IP_RATE_LIMIT: RateLimitRule = {
  limit: 20,
  windowMs: 5 * 60 * 1000,
};

export interface RateLimitBoundaryOptions {
  /** A human-readable `"METHOD /path"` label, used only for logging. */
  route: string;
  repo?: Pick<RateLimitRepository, 'incrementAndGet'>;
  now?: () => Date;
  sessionRule?: RateLimitRule;
  userRule?: RateLimitRule;
  ipRule?: RateLimitRule;
  /** Resolve an authenticated user for routes that have one; omit on pre-auth routes. */
  resolveUserId?: (request: Request) => Promise<string | null>;
  onLimited?: (info: {
    scope: 'session' | 'user' | 'ip';
    requestId: string;
    route: string;
  }) => void;
}

/**
 * Wraps a `/api/v1/*` Route Handler with a rate-limit check (issue #127).
 *
 * Self-hosted and Postgres-backed (`~/server/repositories/rate-limit.ts`'s
 * fixed-window counters) rather than a new managed service - this stack has
 * no Redis in its dependency tree. See
 * docs/api-compatibility-and-deprecation.md for the full design and its
 * documented limitations.
 *
 * Three independent limits apply to authenticated routes, any of which can
 * reject a request:
 * - **Per-session**: keyed by a hash of the caller's credential (bearer
 *   token or session cookie) - see `sessionKeyFor`.
 * - **Per-user**: keyed by a hash of the authenticated user id and shared by
 *   all of that user's sessions/devices. Routes opt into this check by
 *   providing `resolveUserId`; genuinely pre-auth routes omit it.
 * - **Per-IP**: a floor that also covers requests with no credential yet
 *   (the mobile OAuth endpoints use a stricter rule here, since IP is the
 *   only signal available pre-auth).
 *
 * A rejected request never reaches the inner handler and always uses the
 * stable v1 error envelope with the documented `rate_limited` code (`429`,
 * `retryable: true`, plus a `Retry-After` header).
 */
export function withApiV1RateLimit(
  handler: (request: Request) => Promise<Response>,
  options: RateLimitBoundaryOptions,
) {
  const repo = options.repo ?? rateLimitRepository;
  const now = options.now ?? (() => new Date());
  const sessionRule = options.sessionRule ?? DEFAULT_SESSION_RATE_LIMIT;
  const userRule = options.userRule ?? DEFAULT_USER_RATE_LIMIT;
  const ipRule = options.ipRule ?? DEFAULT_IP_RATE_LIMIT;
  const onLimited = options.onLimited ?? (() => undefined);

  return async function rateLimited(request: Request): Promise<Response> {
    const requestId = requestIdFor(request);
    const nowValue = now();

    const checks: Array<{
      scope: 'session' | 'ip';
      key: string;
      rule: RateLimitRule;
    }> = [];
    const sessionKey = sessionKeyFor(request);
    if (sessionKey)
      checks.push({ scope: 'session', key: sessionKey, rule: sessionRule });
    const ipKey = ipKeyFor(request);
    if (ipKey) checks.push({ scope: 'ip', key: ipKey, rule: ipRule });

    const enforce = async (
      scope: 'session' | 'user' | 'ip',
      key: string,
      rule: RateLimitRule,
    ): Promise<Response | null> => {
      const decision = await evaluateRateLimit(repo, key, rule, nowValue);
      if (decision.allowed) return null;

      onLimited({ scope, requestId, route: options.route });
      logger.warn('[ApiV1] rate limit exceeded', {
        route: options.route,
        scope,
        requestId,
        limit: decision.limit,
        retryAfterSeconds: decision.retryAfterSeconds,
      });
      return Response.json(
        errorEnvelope(
          'rate_limited',
          'Too many requests. Please slow down and try again later.',
          { requestId, retryable: true },
        ),
        {
          status: 429,
          headers: { 'Retry-After': String(decision.retryAfterSeconds) },
        },
      );
    };

    for (const check of checks) {
      const limitedResponse = await enforce(check.scope, check.key, check.rule);
      if (limitedResponse) return limitedResponse;
    }

    if (options.resolveUserId) {
      const userId = await options.resolveUserId(request);
      const userKey = userId ? userKeyFor(userId) : null;
      if (userKey) {
        const limitedResponse = await enforce('user', userKey, userRule);
        if (limitedResponse) return limitedResponse;
      }
    }

    return handler(request);
  };
}
