import {db} from "~/server/db";
import {accounts} from "./server/db/schema";

import NextAuth from "next-auth";
import Strava from "next-auth/providers/strava";
import {DrizzleAdapter} from "@auth/drizzle-adapter";

export const getAccount = async ({
  providerID,
  userID,
}: {
  providerID?: number;
  userID?: string;
}) => {
  if (!providerID && !userID)
    throw new Error("No providerID or userID provided");
  const account = providerID
    ? await db.query.accounts.findFirst({
        where: (accounts, {eq}) =>
          eq(accounts.providerAccountId, providerID),
      })
    : await db.query.accounts.findFirst({
        where: (accounts, {eq}) =>
          eq(accounts.userId, userID!),
      });
  if (!account) throw new Error("Account not found");
  if (
    account.expires_at &&
    account.expires_at * 1000 < Date.now()
  ) {
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
            client_secret: process.env.AUTH_STRAVA_SECRET,
            grant_type: "refresh_token",
            refresh_token: account.refresh_token,
          }),
        }
      );

      const tokens = (await response.json()) as Record<
        string,
        unknown
      >;

      console.log("Refreshed access token", tokens);

      if (!response.ok) throw tokens;

      account.access_token = tokens.access_token as string;
      account.expires_at = Math.floor(
        Date.now() / 1000 + (tokens.expires_in as number)
      );
      account.refresh_token =
        (tokens.refresh_token as string) ??
        account.refresh_token;

      await db
        .insert(accounts)
        .values(account)
        .onConflictDoUpdate({
          target: accounts.providerAccountId,
          set: account,
        });
    } catch (error) {
      console.error("Error refreshing access token", error);
      throw new Error("Failed to refresh access token");
    }
  }
  return account;
};

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
      const strava = await getAccount({userID: user.id});
      if (!strava)
        throw new Error(`Account for ${user.id} not found`);
      return session;
    },
  },
});
