import NextAuth from "next-auth";
import Strava from "next-auth/providers/strava";
import {DrizzleAdapter} from "@auth/drizzle-adapter";
import {db} from "~/server/db";
import {accounts} from "./server/db/schema";

export const {handlers, signIn, signOut, auth} = NextAuth({
  providers: [
    Strava({
      authorization: {
        params: {scope: "activity:read,activity:write"},
      },
    }),
  ],
  adapter: DrizzleAdapter(db),
  callbacks: {
    async session({session, user}) {
      console.log("Session");
      const strava = await db.query.accounts.findFirst({
        where: (accounts, {eq}) =>
          eq(accounts.userId, user.id),
      });
      if (!strava)
        throw new Error(`Account for ${user.id} not found`);
      if (
        strava.expires_at &&
        strava.expires_at * 1000 < Date.now()
      ) {
        //console.log("Refreshing access token");
        try {
          const response = await fetch(
            "https://www.strava.com/api/v3/oauth/token",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                client_id: process.env.AUTH_STRAVA_ID,
                client_secret:
                  process.env.AUTH_STRAVA_SECRET,
                grant_type: "refresh_token",
                refresh_token: strava.refresh_token,
              }),
            }
          );

          const tokens = (await response.json()) as Record<
            string,
            unknown
          >;

          console.log("Refreshed access token", tokens);

          if (!response.ok) throw tokens;

          const new_keys = {
            access_token: tokens.access_token as string,
            expires_at: Math.floor(
              Date.now() / 1000 +
                (tokens.expires_in as number)
            ),
            refresh_token:
              (tokens.refresh_token as string) ??
              strava.refresh_token,
          };
          await db
            .insert(accounts)
            .values({
              ...strava,
              ...new_keys,
            })
            .onConflictDoUpdate({
              target: accounts.providerAccountId,
              set: new_keys,
            });
        } catch (error) {
          console.error(
            "Error refreshing access token",
            error
          );
        }
      }
      return session;
    },
  },
});
