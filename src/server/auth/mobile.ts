import 'server-only';

import { randomBytes, createHash } from 'node:crypto';

import {
  mobileLoginCodesRepository,
  type MobileLoginCodesRepository,
} from '~/server/repositories/mobile-login-codes';

/**
 * Mobile authentication (issue #121).
 *
 * `resolveActor` (`./actor.ts`) already resolves a signed
 * `Authorization: Bearer <session-token>` header to an `Actor` via Better
 * Auth's `bearer` plugin. This module implements the piece that was still
 * missing: the SwiftUI login flow that *issues* such a token to a native
 * client in the first place - the state/PKCE/one-time-code exchange
 * described in docs/swiftui-backend-preparation-plan.md ("Authentication
 * design").
 *
 * Decision record (issue #121's "spike comparing Better Auth bearer
 * sessions with a dedicated mobile-session table"): this module reuses
 * Better Auth's own bearer-session mechanism rather than adding a second,
 * parallel session table. `src/lib/auth.ts` already configures the
 * `bearer` plugin with `requireSignature: true`, and `resolveActor` already
 * treats a signed bearer header exactly like the browser cookie. The one
 * missing piece - handing a native client a signed session token without
 * ever putting it in a URL - is what `issueMobileLoginCode` /
 * `exchangeMobileLoginCode` below provide: the universal-link redirect
 * only ever carries an opaque, hashed, single-use, short-lived code (see
 * `~/server/db/schema.ts`'s `mobileLoginCodes` table and
 * `~/server/repositories/mobile-login-codes.ts`), and the actual bearer
 * token is only returned once, over POST, after that code (plus its PKCE
 * verifier and the original `state`) has been validated. No separate
 * mobile-session table, rotating refresh tokens, or parallel expiry/
 * revocation model is needed: revocation is Better Auth's existing
 * session revocation (see `revokeCurrentSession` below), and expiry is
 * Better Auth's existing session expiry.
 */

/** How long a mobile login code is valid for before it must be rejected. */
export const MOBILE_LOGIN_CODE_TTL_MS = 5 * 60 * 1000;

export type MobileAuthErrorCode =
  | 'invalid_code'
  | 'expired_code'
  | 'replayed_code'
  | 'state_mismatch'
  | 'pkce_mismatch';

export class MobileAuthError extends Error {
  readonly code: MobileAuthErrorCode;

  constructor(code: MobileAuthErrorCode, message: string) {
    super(message);
    this.name = 'MobileAuthError';
    this.code = code;
  }
}

/** Generates the plaintext one-time code handed to the client via the redirect. */
export function generateMobileLoginCode(): string {
  return randomBytes(32).toString('base64url');
}

/** Hashes a plaintext code for storage/lookup - the DB never holds the plaintext. */
export function hashMobileLoginCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('base64url');
}

/**
 * RFC 7636 PKCE "S256" challenge derivation: `BASE64URL(SHA256(verifier))`.
 */
export function computeS256PkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

export type IssueMobileLoginCodeInput = {
  userId: string;
  state: string;
  pkceChallenge: string;
  redirectUri: string;
  /**
   * The already-signed Better Auth bearer session token for the browser
   * session that just completed the Strava OAuth round trip (obtained via
   * `getSessionCookie()` at the `/api/v1/auth/mobile/callback` boundary -
   * see that route's handler). Stored only until the code is consumed or
   * expires.
   */
  sessionBearerToken: string;
};

export type IssueMobileLoginCodeDependencies = {
  repository?: MobileLoginCodesRepository;
  now?: () => Date;
  generateCode?: () => string;
  ttlMs?: number;
};

/**
 * Persists a one-time mobile login code and returns its plaintext value,
 * for `/api/v1/auth/mobile/callback` to embed in the allow-listed
 * universal-link redirect (alongside the original `state`).
 */
export async function issueMobileLoginCode(
  input: IssueMobileLoginCodeInput,
  {
    repository = mobileLoginCodesRepository,
    now = () => new Date(),
    generateCode = generateMobileLoginCode,
    ttlMs = MOBILE_LOGIN_CODE_TTL_MS,
  }: IssueMobileLoginCodeDependencies = {},
): Promise<{ code: string }> {
  const code = generateCode();
  const createdAt = now();
  await repository.create({
    codeHash: hashMobileLoginCode(code),
    state: input.state,
    pkceChallenge: input.pkceChallenge,
    redirectUri: input.redirectUri,
    userId: input.userId,
    sessionBearerToken: input.sessionBearerToken,
    expiresAt: new Date(createdAt.getTime() + ttlMs),
  });
  return { code };
}

export type ExchangeMobileLoginCodeInput = {
  code: string;
  pkceVerifier: string;
  state: string;
};

export type ExchangeMobileLoginCodeDependencies = {
  repository?: MobileLoginCodesRepository;
  now?: () => Date;
};

export type ExchangeMobileLoginCodeResult = {
  bearerToken: string;
  userId: string;
};

/**
 * Validates and consumes a one-time mobile login code
 * (`POST /api/v1/auth/mobile/exchange`'s entry point), returning the
 * Better Auth bearer session token the code was issued for.
 *
 * Every failure path throws a `MobileAuthError` with a stable `code` the
 * route handler maps to the v1 error envelope. Order of checks: the code
 * must exist and not already be consumed (`consumeByCodeHash` is the
 * single atomic statement that makes a replay - including a concurrent
 * one - impossible to win twice), then not be expired, then its bound
 * `state` and PKCE challenge must match what the caller presents now.
 */
export async function exchangeMobileLoginCode(
  input: ExchangeMobileLoginCodeInput,
  {
    repository = mobileLoginCodesRepository,
    now = () => new Date(),
  }: ExchangeMobileLoginCodeDependencies = {},
): Promise<ExchangeMobileLoginCodeResult> {
  const codeHash = hashMobileLoginCode(input.code);
  const currentTime = now();

  const consumed = await repository.consumeByCodeHash(codeHash, currentTime);
  if (!consumed) {
    const existing = await repository.findByCodeHash(codeHash);
    if (existing) {
      throw new MobileAuthError(
        'replayed_code',
        'This mobile login code has already been used.',
      );
    }
    throw new MobileAuthError(
      'invalid_code',
      'This mobile login code is not recognized.',
    );
  }

  // Consuming an expired code above (rather than leaving it unconsumed)
  // means an expired code can never be replayed either, even though it is
  // rejected here.
  if (consumed.expiresAt.getTime() < currentTime.getTime()) {
    throw new MobileAuthError(
      'expired_code',
      'This mobile login code has expired.',
    );
  }

  if (consumed.state !== input.state) {
    throw new MobileAuthError(
      'state_mismatch',
      'The state parameter does not match the one used to start this login.',
    );
  }

  if (computeS256PkceChallenge(input.pkceVerifier) !== consumed.pkceChallenge) {
    throw new MobileAuthError(
      'pkce_mismatch',
      'The PKCE verifier does not match the challenge used to start this login.',
    );
  }

  if (!consumed.sessionBearerToken) {
    // Should be unreachable in practice (the token is only cleared by the
    // same consume step that just succeeded), but fail closed rather than
    // returning an empty credential if it ever happens.
    throw new MobileAuthError(
      'invalid_code',
      'This mobile login code has no associated session.',
    );
  }

  return {
    bearerToken: consumed.sessionBearerToken,
    userId: consumed.userId,
  };
}
