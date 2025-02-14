import { db } from '~/server/db';

import NextAuth from 'next-auth';
import Strava from 'next-auth/providers/strava';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { Adapter } from 'next-auth/adapters';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Strava({
      authorization: {
        params: { scope: 'activity:read,activity:write' },
      },
    }),
  ],
  adapter: DrizzleAdapter(db) as Adapter,
  callbacks: {
    async session({ session }) {
      /*const strava = await getAccount({userID: user.id});
      if (!strava)
        throw new Error(`Account for ${user.id} not found`);*/
      return session;
    },
    async signIn({ user, account, profile, email, credentials }) {
      if (user && user.id) {
        const db_user = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, user.id as string),
        });
      }
      return true;
    },
  },
});
