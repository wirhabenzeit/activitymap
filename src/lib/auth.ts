import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { createAuthMiddleware } from "better-auth/api";
import { db } from "~/server/db";
import { users, accounts, sessions, verification } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const stravaProfileSchema = z.object({
    id: z.union([z.string(), z.number()]),
    email: z.string().email().nullish(),
    firstname: z.string().nullish(),
    lastname: z.string().nullish(),
    profile: z.string().nullish(),
});

function getSessionUserId(value: unknown): string | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }

    const session = value as { user?: { id?: unknown } };
    return typeof session.user?.id === "string" ? session.user.id : null;
}

function isStravaAccount(value: unknown): value is { providerId: "strava"; accountId: string } {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const account = value as { providerId?: unknown; accountId?: unknown };
    return account.providerId === "strava" && typeof account.accountId === "string";
}

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

                        const rawProfile: unknown = await response.json();
                        const parsedProfile = stravaProfileSchema.safeParse(rawProfile);
                        if (!parsedProfile.success) {
                            return null;
                        }

                        const profile = parsedProfile.data;
                        const athleteId = profile.id.toString();
                        const fullName = `${profile.firstname ?? ""} ${profile.lastname ?? ""}`.trim();

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
    ],
    session: {
        expiresIn: 60 * 60 * 24 * 30, // 30 days
        updateAge: 60 * 60 * 24, // 1 day
    },
    // Hook to update athlete_id after OAuth sign-in
    hooks: {
        after: createAuthMiddleware(async (ctx) => {
            // Check if this is a social sign-in callback
            if (ctx.path.startsWith("/sign-in/social/callback")) {
                const userId = getSessionUserId(ctx.context.newSession as unknown);
                const account = ctx.context.account as unknown;

                if (userId && isStravaAccount(account)) {
                    try {
                        const athleteId = Number(account.accountId);
                        if (!Number.isFinite(athleteId)) {
                            return;
                        }

                        await db
                            .update(users)
                            .set({ athlete_id: athleteId })
                            .where(eq(users.id, userId));

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
