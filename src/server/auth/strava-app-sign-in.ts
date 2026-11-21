import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { handleOAuthUserInfo } from 'better-auth/oauth2';
import { z } from 'zod';

import { grantedStravaScope } from '~/lib/strava-permissions';
import {
  type StravaAuthorizationTokens,
  StravaCodeRejectedError,
} from '~/server/strava/authorization-code';

import type { StravaUserInfo } from './strava-profile';

/**
 * Completes a Strava sign-in that began in the installed Strava app (issue
 * #305), minting the same kind of Better Auth session the web callback does:
 * the same user and account lookup, token storage and linking rules
 * (`handleOAuthUserInfo`), without Better Auth's OAuth state cookie, which an
 * app-to-app round trip never has.
 *
 * The endpoint is `SERVER_ONLY`: Better Auth's router never serves it over
 * HTTP, so only `auth.api.stravaAppSignIn` in this process can reach it. That
 * matters because it turns an authorization code into a session without any
 * check of its own. The caller (`~/app/api/v1/auth/mobile/strava/complete`)
 * must first consume the attempt that code belongs to.
 */

export const STRAVA_APP_PROVIDER_ID = 'strava';

export type StravaAppSignInOptions = {
  exchangeCode: (code: string) => Promise<StravaAuthorizationTokens>;
  fetchUserInfo: (accessToken: string) => Promise<StravaUserInfo | null>;
  /** Links the athlete and records the granted scopes (shared with the web). */
  finishSignIn: (userId: string, scope: string | null) => Promise<void>;
};

export function stravaAppSignIn(options: StravaAppSignInOptions) {
  return {
    id: 'strava-app-sign-in',
    endpoints: {
      stravaAppSignIn: createAuthEndpoint(
        '/strava-app/sign-in',
        {
          method: 'POST',
          body: z.object({
            code: z.string().min(1),
            scope: z.string().nullish(),
          }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          let tokens: StravaAuthorizationTokens;
          try {
            tokens = await options.exchangeCode(ctx.body.code);
          } catch (error) {
            if (error instanceof StravaCodeRejectedError) {
              throw new APIError('UNAUTHORIZED', {
                code: 'strava_code_rejected',
                message: 'Strava did not accept the authorization code.',
              });
            }
            throw error;
          }

          const profile = await options.fetchUserInfo(tokens.accessToken);
          if (!profile) {
            throw new APIError('BAD_GATEWAY', {
              code: 'strava_profile_unavailable',
              message: 'The Strava profile could not be read.',
            });
          }

          const scope = grantedStravaScope(ctx.body.scope);
          const result = await handleOAuthUserInfo(ctx, {
            userInfo: {
              id: profile.id,
              email: profile.email,
              name: profile.name,
              image: profile.image,
              emailVerified: profile.emailVerified,
            },
            account: {
              providerId: STRAVA_APP_PROVIDER_ID,
              accountId: profile.id,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              accessTokenExpiresAt: tokens.accessTokenExpiresAt,
              ...(scope ? { scope } : {}),
            },
          });
          if (result.error || !result.data) {
            throw new APIError('UNAUTHORIZED', {
              code: 'strava_sign_in_failed',
              message: result.error ?? 'The sign-in could not be completed.',
            });
          }

          const { session, user } = result.data;
          try {
            await options.finishSignIn(user.id, scope);
          } catch (error) {
            // No half-linked session: the person starts over.
            await ctx.context.internalAdapter
              .deleteSession(session.token)
              .catch(() => undefined);
            throw error;
          }

          await setSessionCookie(ctx, { session, user });
          return ctx.json({ userId: user.id });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
