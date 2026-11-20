import { randomUUID } from 'node:crypto';

import { errorEnvelope } from '~/contracts/v1/error';
import type { MobileAttemptBinding } from '~/server/auth/mobile-attempt';
import { mobileAuthErrorRedirect } from '~/server/auth/mobile-error-redirect';
import {
  type AllowlistedRedirectPrefix,
  isAllowedMobileRedirectUri,
  loadMobileRedirectAllowlist,
} from '~/server/auth/mobile-redirect-allowlist';
import { requestIdFor } from '~/server/http/request-id';

export interface MobileAuthCallbackHandlerDependencies {
  createRequestId?: () => string;
  onError?: (error: unknown, requestId: string) => void;
  /** Defaults to the `MOBILE_AUTH_REDIRECT_ALLOWLIST` env var. */
  loadRedirectAllowlist?: () => AllowlistedRedirectPrefix[];
  /**
   * Resolves the browser session behind the request's cookie (wired in
   * `route.ts` to `auth.api.getSession`): its user and when it was created.
   */
  resolveSession: (
    headers: Headers,
  ) => Promise<{ userId: string; createdAt: Date } | null>;
  /**
   * Ties this callback to the `/mobile/start` attempt that began it. Without
   * it any browser session, however old, would be handed to whoever crafted
   * the callback URL (issue #482).
   */
  attempts: MobileAttemptBinding;
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
  resolveSession,
  attempts,
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

    // Better Auth sends a declined or failed Strava authorization here (the
    // `errorCallbackURL` set by `/mobile/start`) with its `error` code. Hand
    // it back to the app, which treats `access_denied` as a cancellation.
    const providerError = url.searchParams.get('error');
    if (providerError) {
      return mobileAuthErrorRedirect(redirectUri, {
        state,
        error: providerError,
        requestId,
      });
    }

    // Every redirect from here on ends the attempt: the cookie that bound it
    // is single-purpose and must not outlive the callback.
    const clearAttempt = attempts.clearCookie(request);
    const redirect = (location: string): Response =>
      new Response(null, {
        status: 302,
        headers: { location, 'set-cookie': clearAttempt },
      });
    const failWith = (error: string): Response =>
      redirect(
        mobileAuthErrorRedirect(redirectUri, {
          state,
          error,
          requestId,
        }).headers.get('location') ?? redirectUri,
      );

    try {
      const session = await resolveSession(request.headers);
      if (!session) return failWith('not_authenticated');

      const verdict = attempts.verify(
        request,
        { state, codeChallenge, redirectUri },
        session.createdAt,
      );
      if (!verdict.ok) {
        // The reason is for operators; the app only needs to know this
        // sign-in did not start from the app.
        onError(
          new Error(`Mobile sign-in attempt rejected: ${verdict.reason}`),
          requestId,
        );
        return failWith('invalid_attempt');
      }

      const sessionBearerToken = extractSessionBearerToken(request);
      if (!sessionBearerToken) {
        throw new Error(
          'Session resolved but no session cookie was present on the request',
        );
      }

      const { code } = await issueLoginCode({
        userId: session.userId,
        state,
        pkceChallenge: codeChallenge,
        redirectUri,
        sessionBearerToken,
      });

      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      target.searchParams.set('state', state);
      return redirect(target.toString());
    } catch (error) {
      onError(error, requestId);
      return failWith('server_error');
    }
  };
}
