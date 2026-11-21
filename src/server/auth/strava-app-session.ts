import 'server-only';

import { isAPIError } from 'better-auth/api';
import { parseSetCookieHeader } from 'better-auth/cookies';

import { StravaAppSignInError } from '~/server/auth/strava-app-sign-in-error';
import { StravaUnavailableError } from '~/server/strava/authorization-code';

/**
 * Turns an authorization code into an ActivityMap bearer session, through the
 * server-only endpoint of `./strava-app-sign-in.ts`. The caller has already
 * consumed the sign-in attempt the code belongs to.
 */
export type StravaAppSignInInput = {
  code: string;
  scope?: string;
  /** The app's request headers, so the session records its client. */
  headers: Headers;
};

/** The slice of the Better Auth instance this needs (`~/lib/auth`). */
export interface StravaAppAuth {
  api: {
    stravaAppSignIn(input: {
      body: { code: string; scope: string | null };
      headers: Headers;
      returnHeaders: true;
    }): Promise<{ headers: Headers }>;
  };
  $context: Promise<{ authCookies: { sessionToken: { name: string } } }>;
}

export function createStravaAppSignIn(auth: StravaAppAuth) {
  return (input: StravaAppSignInInput) => signInWithStravaApp(auth, input);
}

export async function signInWithStravaApp(
  auth: StravaAppAuth,
  input: StravaAppSignInInput,
): Promise<{ bearerToken: string }> {
  let outgoing: Headers;
  try {
    ({ headers: outgoing } = await auth.api.stravaAppSignIn({
      body: { code: input.code, scope: input.scope ?? null },
      headers: input.headers,
      returnHeaders: true,
    }));
  } catch (error) {
    if (error instanceof StravaUnavailableError) {
      throw new StravaAppSignInError(
        'upstream_unavailable',
        502,
        true,
        'Strava could not be reached.',
      );
    }
    if (isAPIError(error)) {
      const code = String(error.body?.code ?? '');
      if (code === 'strava_code_rejected') {
        throw new StravaAppSignInError(
          'strava_code_rejected',
          401,
          false,
          'Strava did not accept the authorization code.',
        );
      }
      if (code === 'strava_profile_unavailable') {
        throw new StravaAppSignInError(
          'upstream_unavailable',
          502,
          true,
          'The Strava profile could not be read.',
        );
      }
    }
    throw error;
  }

  // The signed session cookie value is a valid bearer token: the `bearer`
  // plugin accepts exactly that format (see `~/server/auth/mobile.ts`).
  const cookieName = (await auth.$context).authCookies.sessionToken.name;
  const bearerToken = parseSetCookieHeader(
    outgoing.get('set-cookie') ?? '',
  ).get(cookieName)?.value;
  if (!bearerToken) throw new Error('The sign-in did not produce a session');
  return { bearerToken };
}
