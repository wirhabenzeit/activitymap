import { betterAuth } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { bearer, jwt, oAuthProxy } from 'better-auth/plugins';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';

import { convexJwtOptions } from '~/lib/auth-jwt';
import { STRAVA_SIGN_IN_SCOPES } from '~/lib/strava-oauth';
import {
  callbackScopeParam,
  grantedStravaScope,
  isStravaSignInCallback,
} from '~/lib/strava-permissions';
import { convexAuthAdapter } from '~/server/auth/convex-adapter';
import { stravaAppSignIn } from '~/server/auth/strava-app-sign-in';
import { fetchStravaUserInfo } from '~/server/auth/strava-profile';
import { finishStravaSignIn } from '~/server/auth/strava-sign-in';
import { stravaAccessEnabled } from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';
import { exchangeStravaAuthorizationCode } from '~/server/strava/authorization-code';

function getSessionUserId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const session = value as { user?: { id?: unknown } };
  return typeof session.user?.id === 'string' ? session.user.id : null;
}

const convexJwt = convexJwtOptions();

export const auth = betterAuth({
  baseURL: {
    allowedHosts: [
      'activitymap.cc',
      'activitymap.dominik.page',
      '*.vercel.app',
      'localhost',
      '127.0.0.1',
    ],
    fallback: process.env.BETTER_AUTH_URL,
    protocol: process.env.NODE_ENV === 'development' ? 'http' : 'https',
  },
  // Sign-in records live in the sign-in store in Convex
  // (`backend/convex/authStore.ts`).
  database: convexAuthAdapter(),
  plugins: [
    ...(stravaAccessEnabled()
      ? [
          genericOAuth({
            config: [
              {
                providerId: 'strava',
                // Strava doesn't have OIDC discovery, so we configure manually
                authorizationUrl: 'https://www.strava.com/oauth/authorize',
                tokenUrl: 'https://www.strava.com/oauth/token',
                userInfoUrl: 'https://www.strava.com/api/v3/athlete',
                clientId: process.env.AUTH_STRAVA_ID!,
                clientSecret: process.env.AUTH_STRAVA_SECRET!,
                scopes: [STRAVA_SIGN_IN_SCOPES],
                pkce: false,
                // Custom function to fetch and map user info from Strava
                getUserInfo: async (tokens) =>
                  tokens.accessToken
                    ? fetchStravaUserInfo(tokens.accessToken)
                    : null,
              },
            ],
          }),
        ]
      : []),
    // Completes a sign-in that began in the installed Strava app. Registered
    // wherever the Strava provider is; it is not reachable over HTTP.
    ...(stravaAccessEnabled()
      ? [
          stravaAppSignIn({
            exchangeCode: exchangeStravaAuthorizationCode,
            fetchUserInfo: fetchStravaUserInfo,
            finishSignIn: finishStravaSignIn,
          }),
        ]
      : []),
    ...(process.env.OAUTH_PROXY_PRODUCTION_URL && process.env.OAUTH_PROXY_SECRET
      ? [
          oAuthProxy({
            productionURL: process.env.OAUTH_PROXY_PRODUCTION_URL,
            secret: process.env.OAUTH_PROXY_SECRET,
          }),
        ]
      : []),
    // Accepts an `Authorization: Bearer <signed-session-token>` header as
    // an alternative to the secure cookie, so non-browser clients (e.g. a
    // future mobile app) can authenticate through the same safe
    // interface without any endpoint accepting a credential in a URL.
    // `requireSignature: true` rejects a raw (unsigned) session token in
    // the header: only the signed cookie value better-auth issues is
    // accepted, so a raw `sessions.sessionToken` value leaked some other
    // way (e.g. serialized into client state) can't be replayed here.
    bearer({ requireSignature: true }),
    // Short-lived tokens for the Convex application backend; off unless an
    // issuer is configured for this environment.
    ...(convexJwt ? [jwt(convexJwt)] : []),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  // Hook to update athlete_id after OAuth sign-in
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      // Both the direct (Production) and proxied (Preview) Strava callbacks
      // create a local session; link its athlete in either case.
      if (isStravaSignInCallback(ctx.path, ctx.params)) {
        const userId = getSessionUserId(ctx.context.newSession);
        if (userId) {
          try {
            // Strava reports the scopes the person actually approved only on
            // this redirect (issue #303).
            const query: unknown = ctx.query;
            const scope = grantedStravaScope(
              callbackScopeParam(ctx.request?.url) ??
                (query && typeof query === 'object' && 'scope' in query
                  ? query.scope
                  : null),
            );
            await finishStravaSignIn(userId, scope);
          } catch (error) {
            logger.error('[Better Auth] Error updating athlete_id:', error);
          }
        }
      }
    }),
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
