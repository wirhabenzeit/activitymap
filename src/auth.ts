import { db } from '~/server/db';
import { users } from '~/server/db/schema';
import { eq } from 'drizzle-orm';

import NextAuth from 'next-auth';
import Strava from 'next-auth/providers/strava';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { Adapter } from 'next-auth/adapters';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Strava({
      authorization: {
        params: { scope: 'read,activity:read,activity:write' },
      },
      clientId: process.env.STRAVA_CLIENT_ID!,
      clientSecret: process.env.STRAVA_CLIENT_SECRET!,
    }),
  ],
  adapter: DrizzleAdapter(db) as Adapter,
  callbacks: {
    async session({ session }) {
      return session;
    },
    async signIn({ user }) {
      console.log('User signed in:', user.id);
      return true;
    },
  },
  events: {
    // This event is triggered when an account is linked to a user
    // The perfect place to save the Strava athlete ID
    async linkAccount({ user, account }) {
      console.log('Linking account:', user.id, account);
      if (
        account.provider === 'strava' &&
        account.providerAccountId &&
        user.id
      ) {
        try {
          // Parse the Strava athlete ID
          const athleteId = Number(account.providerAccountId);

          // Update the user's athlete_id in the database
          await db
            .update(users)
            .set({ athlete_id: athleteId })
            .where(eq(users.id, user.id));

          console.log(`Updated athlete_id ${athleteId} for user ${user.id}`);
        } catch (error) {
          console.error('Error updating athlete_id:', error);
        }
      }
    },
  },
});
