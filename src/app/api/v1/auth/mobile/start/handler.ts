import { randomUUID } from 'node:crypto';

import { requestIdFor } from '~/server/http/request-id';

import { errorEnvelope } from '~/contracts/v1/error';
import {
  isAllowedMobileRedirectUri,
  loadMobileRedirectAllowlist,
  type AllowlistedRedirectPrefix,
} from '~/server/auth/mobile-redirect-allowlist';

export interface MobileAuthStartHandlerDependencies {
  createRequestId?: () => string;
  onError?: (error: unknown, requestId: string) => void;
  /** Defaults to the `MOBILE_AUTH_REDIRECT_ALLOWLIST` env var. */
  loadRedirectAllowlist?: () => AllowlistedRedirectPrefix[];
  /**
   * Starts the existing server-side Strava OAuth flow (the same one the
   * web sign-in uses - see `~/lib/auth.ts`'s `genericOAuth` config) with a
   * callback URL that lands back on `/api/v1/auth/mobile/callback`. Wired
   * in `route.ts` to `auth.api.signInSocial`.
   */
  startSocialSignIn: (input: {
    callbackURL: string;
    headers: Headers;
  }) => Promise<{ url: string } | null>;
}

/**
 * Builds the `/api/v1/auth/mobile/callback` URL that carries the mobile
 * client's `state`, PKCE challenge, and (already allow-list-validated)
 * target redirect URI through the Strava OAuth round trip. Better Auth
 * stores `callbackURL` verbatim and redirects to it unmodified once
 * sign-in completes, which is what makes this round trip possible without
 * a server-side pending-request table.
 */
export function buildMobileCallbackUrl(
  requestUrl: string,
  params: { state: string; codeChallenge: string; redirectUri: string },
): string {
  const callback = new URL('/api/v1/auth/mobile/callback', requestUrl);
  callback.searchParams.set('state', params.state);
  callback.searchParams.set('code_challenge', params.codeChallenge);
  callback.searchParams.set('redirect_uri', params.redirectUri);
  return callback.toString();
}

/**
 * Build the `GET /api/v1/auth/mobile/start` Route Handler. SwiftUI's
 * `ASWebAuthenticationSession` opens this URL with `state`, `code_challenge`
 * (PKCE, S256), and `redirect_uri` (the allow-listed universal link) as
 * query parameters; see docs/swiftui-backend-preparation-plan.md,
 * "Authentication design".
 */
export function createMobileAuthStartHandler({
  createRequestId = randomUUID,
  onError = () => undefined,
  loadRedirectAllowlist = loadMobileRedirectAllowlist,
  startSocialSignIn,
}: MobileAuthStartHandlerDependencies) {
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

    // Reject an out-of-allow-list redirect target here, before the Strava
    // round trip even starts, rather than only at the callback - the
    // issue's acceptance criteria calls out rejecting this "at the point
    // the universal-link redirect is constructed", and this is the
    // earliest such point.
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
      const callbackURL = buildMobileCallbackUrl(request.url, {
        state,
        codeChallenge,
        redirectUri,
      });
      const result = await startSocialSignIn({
        callbackURL,
        headers: request.headers,
      });
      if (!result?.url) {
        throw new Error('Strava sign-in did not return an authorization URL');
      }
      return Response.redirect(result.url, 302);
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
