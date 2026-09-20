import { randomUUID } from 'node:crypto';

import { errorEnvelope } from '~/contracts/v1/error';
import {
  isAllowedMobileRedirectUri,
  loadMobileRedirectAllowlist,
  type AllowlistedRedirectPrefix,
} from '~/server/auth/mobile-redirect-allowlist';

export interface MobileAuthCallbackHandlerDependencies {
  createRequestId?: () => string;
  onError?: (error: unknown, requestId: string) => void;
  /** Defaults to the `MOBILE_AUTH_REDIRECT_ALLOWLIST` env var. */
  loadRedirectAllowlist?: () => AllowlistedRedirectPrefix[];
  /**
   * Resolves the just-completed browser session's user id from the
   * request's cookie (wired in `route.ts` to `auth.api.getSession`).
   */
  resolveSessionUserId: (headers: Headers) => Promise<string | null>;
  /**
   * Extracts the already-signed Better Auth bearer session token from the
   * request (wired in `route.ts` to `getSessionCookie` from
   * `better-auth/cookies`) - see `~/server/auth/mobile.ts`'s decision
   * record for why this is safe to hand to the mobile client later.
   */
  extractSessionBearerToken: (request: Request) => string | null;
  /** Wired in `route.ts` to `issueMobileLoginCode`. */
  issueLoginCode: (input: {
    userId: string;
    state: string;
    pkceChallenge: string;
    redirectUri: string;
    sessionBearerToken: string;
  }) => Promise<{ code: string }>;
}

function requestIdFor(request: Request, createRequestId: () => string): string {
  const suppliedRequestId = request.headers.get('x-request-id')?.trim();
  if (suppliedRequestId) return suppliedRequestId;
  return createRequestId();
}

/**
 * Build the `GET /api/v1/auth/mobile/callback` Route Handler: Strava's
 * OAuth callback (handled by Better Auth itself) redirects here once the
 * browser session cookie has been set, via the `callbackURL` that
 * `/api/v1/auth/mobile/start` constructed. This handler mints a one-time
 * login code bound to that session and redirects to the mobile client's
 * (already allow-list-validated) universal link with only that opaque
 * code and the original `state` - never a session credential - in the
 * query string.
 */
export function createMobileAuthCallbackHandler({
  createRequestId = randomUUID,
  onError = () => undefined,
  loadRedirectAllowlist = loadMobileRedirectAllowlist,
  resolveSessionUserId,
  extractSessionBearerToken,
  issueLoginCode,
}: MobileAuthCallbackHandlerDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = requestIdFor(request, createRequestId);
    const url = new URL(request.url);
    const state = url.searchParams.get('state');
    const codeChallenge = url.searchParams.get('code_challenge');
    const redirectUri = url.searchParams.get('redirect_uri');

    if (!state || !codeChallenge || !redirectUri) {
      return Response.json(
        errorEnvelope(
          'invalid_request',
          'state, code_challenge, and redirect_uri are all required.',
          { requestId },
        ),
        { status: 400 },
      );
    }

    // Defense in depth: `/mobile/start` already checked this before
    // starting the Strava round trip, but this handler is the one that
    // actually constructs the universal-link redirect, so it re-checks
    // rather than trusting the round-tripped query parameter.
    if (!isAllowedMobileRedirectUri(redirectUri, loadRedirectAllowlist())) {
      return Response.json(
        errorEnvelope(
          'redirect_not_allowed',
          'This redirect target is not allow-listed for mobile sign-in.',
          { requestId },
        ),
        { status: 400 },
      );
    }

    try {
      const userId = await resolveSessionUserId(request.headers);
      if (!userId) {
        return Response.json(
          errorEnvelope('not_authenticated', 'Authentication is required.', {
            requestId,
          }),
          { status: 401 },
        );
      }

      const sessionBearerToken = extractSessionBearerToken(request);
      if (!sessionBearerToken) {
        throw new Error(
          'Session resolved but no session cookie was present on the request',
        );
      }

      const { code } = await issueLoginCode({
        userId,
        state,
        pkceChallenge: codeChallenge,
        redirectUri,
        sessionBearerToken,
      });

      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      target.searchParams.set('state', state);
      return Response.redirect(target.toString(), 302);
    } catch (error) {
      onError(error, requestId);
      return Response.json(
        errorEnvelope('internal_error', 'The request could not be completed.', {
          requestId,
          retryable: true,
        }),
        { status: 500 },
      );
    }
  };
}
