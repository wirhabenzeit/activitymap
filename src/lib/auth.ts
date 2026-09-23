import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { bearer, oAuthProxy } from 'better-auth/plugins';
import { createAuthMiddleware } from 'better-auth/api';
import { db } from '~/server/db';
import { users, accounts, sessions, verification } from '~/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logger } from '~/server/logging/logger';
import { stravaAccessEnabled } from '~/server/config/external-effects';

const stravaProfileSchema = z.object({
  id: z.union([z.string(), z.number()]),
  email: z.string().email().nullish(),
  firstname: z.string().nullish(),
  lastname: z.string().nullish(),
  profile: z.string().nullish(),
});

function getSessionUserId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const session = value as { user?: { id?: unknown } };
  return typeof session.user?.id === 'string' ? session.user.id : null;
}

export const auth = betterAuth({
  baseURL: {
    allowedHosts: [
      'activitymap.dominik.page',
      '*.vercel.app',
      'localhost',
      '127.0.0.1',
    ],
    fallback: process.env.BETTER_AUTH_URL,
    protocol: process.env.NODE_ENV === 'development' ? 'http' : 'https',
  },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      account: accounts,
      session: sessions,
      verification: verification,
    },
  }),
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
                scopes: ['read,activity:read_all,activity:write'],
                pkce: false,
                // Custom function to fetch and map user info from Strava
                getUserInfo: async (tokens) => {
                  const response = await fetch(
                    'https://www.strava.com/api/v3/athlete',
                    {
                      headers: {
                        Authorization: `Bearer ${tokens.accessToken}`,
                      },
                    },
                  );

                  if (!response.ok) {
                    return null;
                  }

                  const rawProfile: unknown = await response.json();
                  const parsedProfile =
                    stravaProfileSchema.safeParse(rawProfile);
                  if (!parsedProfile.success) {
                    return null;
                  }

                  const profile = parsedProfile.data;
                  const athleteId = profile.id.toString();
                  const fullName =
                    `${profile.firstname ?? ''} ${profile.lastname ?? ''}`.trim();

                  return {
                    id: athleteId,
                    email: profile.email ?? `${athleteId}@strava.local`,
                    name: fullName || `Strava ${athleteId}`,
                    image: profile.profile ?? undefined,
                    emailVerified: false,
                  };
                },
              },
            ],
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
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  // Hook to update athlete_id after OAuth sign-in
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      // Both the direct and proxied Strava callbacks create a local session.
      if (ctx.path.startsWith('/callback/strava')) {
        const userId = getSessionUserId(ctx.context.newSession);
        if (userId) {
          try {
            const account = await db.query.accounts.findFirst({
              where: and(
                eq(accounts.userId, userId),
                eq(accounts.providerId, 'strava'),
              ),
            });
            if (!account) return;
            const athleteId = Number(account.accountId);
            if (!Number.isFinite(athleteId)) {
              return;
            }

            await db
              .update(users)
              .set({ athlete_id: athleteId })
              .where(eq(users.id, userId));
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
