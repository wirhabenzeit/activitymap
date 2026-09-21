import { createHash } from 'node:crypto';

import type { RateLimitRepository } from '~/server/repositories/rate-limit';

export type RateLimitRule = {
  /** Requests allowed per window (inclusive). */
  limit: number;
  windowMs: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  /** Requests still allowed in the current window; `0` once exhausted, never negative. */
  remaining: number;
  /** Seconds until the current window rolls over; always at least `1`. */
  retryAfterSeconds: number;
};

/**
 * Fixed-window rate limiting (issue #127): the window a given `now` falls
 * into is `[floor(now / windowMs) * windowMs, + windowMs)`, so all callers
 * checking the same key agree on the same window boundary without needing
 * to coordinate. This is simpler and cheaper (one row per key per window,
 * one atomic increment) than a sliding-window or token-bucket scheme; its
 * known trade-off is that a burst spanning a window boundary can allow up
 * to ~2x `limit` requests in the worst case (e.g. `limit` requests in the
 * last millisecond of one window and `limit` more in the first millisecond
 * of the next). That is an acceptable trade-off for abuse/cost protection
 * at this API's scale - see docs/api-compatibility-and-deprecation.md.
 */
export async function evaluateRateLimit(
  repo: Pick<RateLimitRepository, 'incrementAndGet'>,
  key: string,
  rule: RateLimitRule,
  now: Date,
): Promise<RateLimitDecision> {
  const windowStart = new Date(
    Math.floor(now.getTime() / rule.windowMs) * rule.windowMs,
  );
  const count = await repo.incrementAndGet(key, windowStart);
  const windowEndMs = windowStart.getTime() + rule.windowMs;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowEndMs - now.getTime()) / 1000),
  );
  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds,
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Better Auth's default cookie name (see `~/contracts/v1/openapi.ts`'s
// `cookieAuth` security scheme); a `Secure` deployment prefixes it with
// `__Secure-`.
const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];

/**
 * Per-session rate-limit key: a hash of the caller's credential (the
 * `Authorization` header for a mobile bearer client, or the session cookie
 * for the web app) - never the raw secret, the same "store a hash, not the
 * value" rule already used for `mobile_login_codes.codeHash` and
 * `share_links.tokenHash`. Returns `null` when the request carries no
 * session credential at all (the pre-auth mobile OAuth endpoints), so
 * callers can fall back to `ipKeyFor`.
 */
export function sessionKeyFor(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization) return `session:${hash(authorization)}`;

  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = part.slice(0, separatorIndex).trim();
    if (!SESSION_COOKIE_NAMES.includes(name)) continue;
    const value = part.slice(separatorIndex + 1).trim();
    if (value) return `session:${hash(value)}`;
  }
  return null;
}

/**
 * Per-IP rate-limit key from the standard reverse-proxy forwarded-for
 * header (Vercel sets `x-forwarded-for`), falling back to `x-real-ip`. This
 * is the only signal available before a request presents any credential
 * (e.g. `/api/v1/auth/mobile/start`), and is also applied as a floor
 * alongside the per-session limit everywhere else. Returns `null` when
 * neither header is present (e.g. a direct local request with no proxy in
 * front of it) rather than guessing.
 */
export function ipKeyFor(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return `ip:${first}`;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return `ip:${realIp}`;
  return null;
}
