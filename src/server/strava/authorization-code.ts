import { z } from 'zod';

import { requireStravaAccessEnabled } from '~/server/config/external-effects';

const STRAVA_TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number().int().positive(),
});

export type StravaAuthorizationTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
};

/** Strava refused the code (used, expired, or issued to another app). */
export class StravaCodeRejectedError extends Error {
  constructor() {
    super('Strava did not accept the authorization code');
    this.name = 'StravaCodeRejectedError';
  }
}

/** Strava could not be reached, or answered with something unusable. */
export class StravaUnavailableError extends Error {
  constructor(message = 'Strava could not be reached') {
    super(message);
    this.name = 'StravaUnavailableError';
  }
}

/**
 * Exchanges an authorization code for tokens: the server-side half of the
 * installed-app sign-in. The client secret never leaves the server.
 *
 * Strava's token endpoint does not need the `redirect_uri` the code was issued
 * for, which is what lets the app, not this server, receive the redirect.
 */
export async function exchangeStravaAuthorizationCode(
  code: string,
  {
    environment = process.env,
    fetchImpl = fetch,
  }: {
    environment?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<StravaAuthorizationTokens> {
  requireStravaAccessEnabled(environment);
  const clientId = environment.AUTH_STRAVA_ID;
  const clientSecret = environment.AUTH_STRAVA_SECRET;
  if (!clientId || !clientSecret) {
    throw new StravaUnavailableError('Strava credentials are not configured');
  }

  let response: Response;
  try {
    response = await fetchImpl(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });
  } catch {
    throw new StravaUnavailableError();
  }

  // 400 is how Strava reports a bad or reused code; anything else 4xx/5xx is
  // not the person's mistake and may succeed on retry.
  if (response.status === 400 || response.status === 401) {
    throw new StravaCodeRejectedError();
  }
  if (!response.ok) {
    throw new StravaUnavailableError(`Strava answered ${response.status}`);
  }

  const tokens = tokenResponseSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!tokens.success) {
    throw new StravaUnavailableError('Strava returned an unexpected response');
  }
  return {
    accessToken: tokens.data.access_token,
    refreshToken: tokens.data.refresh_token,
    accessTokenExpiresAt: new Date(tokens.data.expires_at * 1000),
  };
}
