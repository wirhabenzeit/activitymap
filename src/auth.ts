import {db} from "~/server/db";

import NextAuth from "next-auth";
import Strava from "next-auth/providers/strava";
import {DrizzleAdapter} from "@auth/drizzle-adapter";

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
      /*const strava = await getAccount({userID: user.id});
      if (!strava)
        throw new Error(`Account for ${user.id} not found`);*/
      return session;
    },
  },
});
