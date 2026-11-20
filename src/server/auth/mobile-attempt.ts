import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Binds the mobile sign-in callback to the sign-in that started it
 * (issue #482).
 *
 * `/api/v1/auth/mobile/callback` used to accept any browser session cookie
 * and any caller-chosen `state`, `code_challenge` and `redirect_uri`, so a
 * crafted callback URL opened in a browser that was already signed in to the
 * web app produced a login code for that existing session. Now
 * `/api/v1/auth/mobile/start` also sets a short-lived, HttpOnly, signed
 * cookie recording a digest of the three values it was started with, and the
 * callback only issues a code when
 *
 * - that cookie is present, correctly signed and unexpired,
 * - its digest matches the `state`, `code_challenge` and `redirect_uri` on
 *   the callback URL, and
 * - the browser session was created after the attempt started. Better Auth
 *   creates a new session on every completed OAuth callback, so a session
 *   that predates the attempt is an ambient one and is never handed out.
 *
 * It needs no pending-attempt table: the cookie is the record, signed with
 * the Better Auth secret. An attacker's own request to `/start` cannot make
 * the victim's browser carry the cookie, and the cookie alone, without a
 * session minted after it, yields nothing.
 */

export const MOBILE_ATTEMPT_COOKIE = 'activitymap_mobile_attempt';
export const MOBILE_ATTEMPT_COOKIE_PATH = '/api/v1/auth/mobile';
/** The Strava consent screen is the slow step; ten minutes is generous. */
export const MOBILE_ATTEMPT_TTL_MS = 10 * 60 * 1000;
/** Tolerated difference between the clocks of two serverless instances. */
export const MOBILE_ATTEMPT_CLOCK_SKEW_MS = 30 * 1000;

export type MobileAttemptParams = {
  state: string;
  codeChallenge: string;
  redirectUri: string;
};

export type MobileAttemptFailure =
  | 'missing_cookie'
  | 'malformed_cookie'
  | 'bad_signature'
  | 'expired'
  | 'params_mismatch'
  | 'session_predates_attempt';

export type MobileAttemptVerdict =
  { ok: true } | { ok: false; reason: MobileAttemptFailure };

/**
 * The seam the start and callback handlers depend on. Production wiring is
 * `createMobileAttemptBinding()`; tests can supply their own.
 */
export type MobileAttemptBinding = {
  /** The `Set-Cookie` header value to attach at `/start`. */
  issueCookie: (params: MobileAttemptParams, request: Request) => string;
  /** Checks a callback request against the cookie it carries. */
  verify: (
    request: Request,
    params: MobileAttemptParams,
    sessionCreatedAt: Date,
  ) => MobileAttemptVerdict;
  /** The `Set-Cookie` header value that removes the cookie again. */
  clearCookie: (request: Request) => string;
};

export type MobileAttemptDependencies = {
  /** Defaults to the Better Auth secret. Fails closed when none is set. */
  secret?: () => string;
  now?: () => Date;
};

function defaultSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret)
    throw new Error('No secret is configured to sign sign-in attempts');
  return secret;
}

export function mobileAttemptDigest(params: MobileAttemptParams): string {
  // JSON, not a delimiter: no value can run into its neighbour.
  return createHash('sha256')
    .update(
      JSON.stringify([params.state, params.codeChallenge, params.redirectUri]),
      'utf8',
    )
    .digest('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('base64url');
}

function equalStrings(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name)
      return part.slice(index + 1).trim();
  }
  return null;
}

function attributes(request: Request, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === 'https:';
  return [
    `Path=${MOBILE_ATTEMPT_COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    // Lax: Strava's redirect back to us is a top-level cross-site GET.
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function createMobileAttemptBinding({
  secret = defaultSecret,
  now = () => new Date(),
}: MobileAttemptDependencies = {}): MobileAttemptBinding {
  return {
    issueCookie(params, request) {
      const payload = Buffer.from(
        JSON.stringify({
          d: mobileAttemptDigest(params),
          iat: now().getTime(),
        }),
      ).toString('base64url');
      const value = `${payload}.${sign(payload, secret())}`;
      return `${MOBILE_ATTEMPT_COOKIE}=${value}; ${attributes(
        request,
        MOBILE_ATTEMPT_TTL_MS / 1000,
      )}`;
    },

    verify(request, params, sessionCreatedAt) {
      const raw = readCookie(
        request.headers.get('cookie'),
        MOBILE_ATTEMPT_COOKIE,
      );
      if (!raw) return { ok: false, reason: 'missing_cookie' };

      const [payload, signature, ...extra] = raw.split('.');
      if (!payload || !signature || extra.length > 0) {
        return { ok: false, reason: 'malformed_cookie' };
      }
      if (!equalStrings(signature, sign(payload, secret()))) {
        return { ok: false, reason: 'bad_signature' };
      }

      let claims: { d?: unknown; iat?: unknown };
      try {
        claims = JSON.parse(
          Buffer.from(payload, 'base64url').toString('utf8'),
        ) as { d?: unknown; iat?: unknown };
      } catch {
        return { ok: false, reason: 'malformed_cookie' };
      }
      if (typeof claims.d !== 'string' || typeof claims.iat !== 'number') {
        return { ok: false, reason: 'malformed_cookie' };
      }

      const age = now().getTime() - claims.iat;
      if (age > MOBILE_ATTEMPT_TTL_MS || age < -MOBILE_ATTEMPT_CLOCK_SKEW_MS) {
        return { ok: false, reason: 'expired' };
      }
      if (!equalStrings(claims.d, mobileAttemptDigest(params))) {
        return { ok: false, reason: 'params_mismatch' };
      }
      if (
        sessionCreatedAt.getTime() <
        claims.iat - MOBILE_ATTEMPT_CLOCK_SKEW_MS
      ) {
        return { ok: false, reason: 'session_predates_attempt' };
      }
      return { ok: true };
    },

    clearCookie(request) {
      return `${MOBILE_ATTEMPT_COOKIE}=; ${attributes(request, 0)}`;
    },
  };
}

/** Production binding, signed with the Better Auth secret. */
export const mobileAttemptBinding = createMobileAttemptBinding();
