import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { createAuthMiddleware } from "better-auth/api";
import { db } from "~/server/db";
import { users, accounts, sessions, verification } from "~/server/db/schema";
import { eq } from "drizzle-orm";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user: users,
            account: accounts,
            session: sessions,
            verification: verification,
        },
    }),
    plugins: [
        genericOAuth({
            config: [
                {
                    providerId: "strava",
                    // Strava doesn't have OIDC discovery, so we configure manually
                    authorizationUrl: "https://www.strava.com/oauth/authorize",
                    tokenUrl: "https://www.strava.com/oauth/token",
                    userInfoUrl: "https://www.strava.com/api/v3/athlete",
                    clientId: process.env.AUTH_STRAVA_ID!,
                    clientSecret: process.env.AUTH_STRAVA_SECRET!,
                    scopes: ["read,activity:read_all,activity:write"],
                    pkce: false,
                    // Custom function to fetch and map user info from Strava
                    getUserInfo: async (tokens) => {
                        const response = await fetch("https://www.strava.com/api/v3/athlete", {
                            headers: {
                                Authorization: `Bearer ${tokens.accessToken}`,
                            },
                        });

                        if (!response.ok) {
                            return null;
                        }

                        const profile = await response.json();

                        return {
                            id: profile.id.toString(),
                            email: profile.email || `${profile.id}@strava.local`,
                            name: `${profile.firstname} ${profile.lastname}`,
                            image: profile.profile,
                            emailVerified: false,
                        };
                    },
                },
            ],
        }),
    ],
    // Hook to update athlete_id after OAuth sign-in
    hooks: {
        after: createAuthMiddleware(async (ctx) => {
            // Check if this is a social sign-in callback
            if (ctx.path.startsWith("/sign-in/social/callback")) {
                const session = ctx.context.newSession;
                const account = ctx.context.account;

                if (session?.user && account && account.providerId === "strava") {
                    try {
                        const athleteId = Number(account.accountId);

                        await db
                            .update(users)
                            .set({ athlete_id: athleteId })
                            .where(eq(users.id, session.user.id));

                        console.log(`[Better Auth] Updated athlete_id ${athleteId} for user ${session.user.id}`);
                    } catch (error) {
                        console.error("[Better Auth] Error updating athlete_id:", error);
                    }
                }
            }
        }),
    },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
