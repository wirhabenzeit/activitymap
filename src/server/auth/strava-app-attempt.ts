import 'server-only';

import { STRAVA_SIGN_IN_SCOPES } from '~/lib/strava-oauth';
import {
  MobileAuthError,
  computeS256PkceChallenge,
  hashMobileLoginCode,
} from '~/server/auth/mobile';
import {
  type StravaAppAttemptsRepository,
  stravaAppAttemptsRepository,
} from '~/server/repositories/strava-app-attempts';

/**
 * Signing in through the installed Strava app (issue #305).
 *
 * The web and `ASWebAuthenticationSession` flows lean on Better Auth's state
 * cookie and a session cookie in one browser jar. Strava's installed-app route
 * returns to the *app*, with an authorization code and no cookie, so the
 * transaction needs another anchor:
 *
 * 1. `start`: the app registers its `state` and PKCE challenge. Nothing but
 *    the hash of `state` and the challenge is stored.
 * 2. The app opens `strava://oauth/mobile/authorize`, and Strava returns the
 *    code to the app.
 * 3. `complete`: the app presents the code with its `state` and PKCE
 *    verifier. The attempt is consumed exactly once, then the code is
 *    exchanged with Strava (the client secret stays here) and a session is
 *    minted in the same request, so no browser session is involved at all.
 *
 * A code taken from a hijacked redirect is useless without the verifier, which
 * never leaves the app.
 */

/** The Strava app's consent screen is the slow step. */
export const STRAVA_APP_ATTEMPT_TTL_MS = 10 * 60 * 1000;

/** Strava's documented installed-app authorization URL. */
export const STRAVA_APP_AUTHORIZE_URL = 'strava://oauth/mobile/authorize';

export type StravaAppAuthorizationConfig = {
  clientId: string;
  /** Where Strava returns the app; must be within the app's callback domain. */
  redirectUri: string;
};

/**
 * The sign-in configuration of this deployment, or `null` when the Strava app
 * handoff is not available (the app then falls back to the web sign-in).
 */
export function stravaAppAuthorizationConfig(
  environment: Record<string, string | undefined> = process.env,
): StravaAppAuthorizationConfig | null {
  const clientId = environment.AUTH_STRAVA_ID?.trim();
  const redirectUri = environment.STRAVA_APP_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) return null;
  try {
    new URL(redirectUri);
  } catch {
    return null;
  }
  return { clientId, redirectUri };
}

export function buildStravaAppAuthorizationUrl(
  config: StravaAppAuthorizationConfig,
  params: { state: string; forceConsent: boolean },
): string {
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    approval_prompt: params.forceConsent ? 'force' : 'auto',
    scope: STRAVA_SIGN_IN_SCOPES,
    state: params.state,
  });
  return `${STRAVA_APP_AUTHORIZE_URL}?${query.toString()}`;
}

export type StravaAppAttemptDependencies = {
  repository?: StravaAppAttemptsRepository;
  now?: () => Date;
  ttlMs?: number;
};

export async function startStravaAppAttempt(
  input: { state: string; pkceChallenge: string },
  {
    repository = stravaAppAttemptsRepository,
    now = () => new Date(),
    ttlMs = STRAVA_APP_ATTEMPT_TTL_MS,
  }: StravaAppAttemptDependencies = {},
): Promise<{ expiresAt: Date }> {
  const expiresAt = new Date(now().getTime() + ttlMs);
  await repository.create({
    stateHash: hashMobileLoginCode(input.state),
    pkceChallenge: input.pkceChallenge,
    expiresAt,
  });
  return { expiresAt };
}

/**
 * Consumes the attempt `state` belongs to, once, and checks the PKCE
 * verifier against it. Every failure is a `MobileAuthError`, the same family
 * the one-time-code exchange raises.
 */
export async function consumeStravaAppAttempt(
  input: { state: string; pkceVerifier: string },
  {
    repository = stravaAppAttemptsRepository,
    now = () => new Date(),
  }: StravaAppAttemptDependencies = {},
): Promise<void> {
  const stateHash = hashMobileLoginCode(input.state);
  const currentTime = now();

  const consumed = await repository.consumeByStateHash(stateHash, currentTime);
  if (!consumed) {
    const existing = await repository.findByStateHash(stateHash);
    throw existing
      ? new MobileAuthError(
          'replayed_code',
          'This sign-in attempt has already been used.',
        )
      : new MobileAuthError(
          'invalid_code',
          'This sign-in attempt is not recognized.',
        );
  }

  // Consumed above even when expired, so an expired attempt is never reusable.
  if (consumed.expiresAt.getTime() < currentTime.getTime()) {
    throw new MobileAuthError(
      'expired_code',
      'This sign-in attempt has expired.',
    );
  }

  if (computeS256PkceChallenge(input.pkceVerifier) !== consumed.pkceChallenge) {
    throw new MobileAuthError(
      'pkce_mismatch',
      'The PKCE verifier does not match the challenge used to start this sign-in.',
    );
  }
}
