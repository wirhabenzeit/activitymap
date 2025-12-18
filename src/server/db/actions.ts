'use server';

import { inArray, eq, desc } from 'drizzle-orm';
import { activities, photos, accounts } from './schema';
import { db } from './index';
import { auth } from '~/lib/auth';
import { headers } from 'next/headers';
import { StravaClient, type StravaTokens } from '~/server/strava/client';

// Define a type for the account based on the database schema
type AccountType = typeof accounts.$inferSelect;

export const getUser = async (id?: string) => {
  if (!id) {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session?.user?.id) throw new Error('Not authenticated');
    id = session.user.id;
  }
  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, id),
  });
  if (!user) throw new Error('User not found');
  return user;
};

export const getAccount = async ({
  providerAccountId,
  userId,
  forceRefresh = false,
}: {
  providerAccountId?: string;
  userId?: string;
  forceRefresh?: boolean;
}) => {

  let account: AccountType | null = null;

  try {
    if (providerAccountId) {

      const result = await db.query.accounts.findFirst({
        where: (accounts, { eq }) =>
          eq(accounts.providerAccountId, providerAccountId),
      });
      // If account not found by providerAccountId, this is likely a webhook request
      // We should not throw an error, but return null to handle this case appropriately
      if (!result) {
        return null;
      }
      account = result;

    } else if (userId) {

      const result = await db.query.accounts.findFirst({
        where: (accounts, { eq }) => eq(accounts.userId, userId),
      });
      if (result) {
        account = result;

      }
    } else {
      // Only try to resolve through session if no IDs provided

      try {
        const resolvedUserId = await getUser().then((user) => user.id);

      } catch (sessionError) {
        console.error(`[DB] Error resolving user from session:`, sessionError);
        throw new Error('Failed to resolve user from session');
      }
    }
  } catch (dbError) {
    console.error(`[DB] Database error in getAccount:`, dbError);
    if (dbError instanceof Error) {
      console.error(
        `[DB] Error name: ${dbError.name}, message: ${dbError.message}`,
      );
      console.error(`[DB] Error stack: ${dbError.stack}`);
    }
    throw new Error('Database error in getAccount');
  }

  // Only throw if we were looking up by userId or through session
  if (!account && !providerAccountId) throw new Error('Account not found');
  // Return null if we were looking up by providerAccountId and didn't find anything
  if (!account) return null;

  const currentTime = Math.floor(Date.now() / 1000);
  const isExpired =
    forceRefresh ||
    (account.expires_at ? currentTime >= account.expires_at : true);

  if (isExpired) {

    try {
      // Create a Strava client with the refresh token
      const stravaClient = StravaClient.withRefreshToken(
        account.refresh_token!, // We know refresh_token exists if we got here
        async (tokens: StravaTokens) => {
          if (!account) return; // Safety check

          // This callback will be called after token refresh
          // Update the account with the new tokens
          const updatedAccount = {
            ...account,
            access_token: tokens.access_token,
            expires_at: tokens.expires_at,
            refresh_token: tokens.refresh_token || account.refresh_token,
          };

          // Update the account in the database
          await db
            .update(accounts)
            .set(updatedAccount)
            .where(eq(accounts.providerAccountId, account.providerAccountId));

          // Update our local copy of the account
          account = updatedAccount;
        },
      );

      // Refresh the token - the callback will handle updating the account
      await stravaClient.refreshAccessToken();



      return account;
    } catch (error) {
      console.error('Error refreshing access token:', error);
      throw new Error('Failed to refresh access token');
    }
  }
  return account;
};

export async function getActivities({
  ids,
  athlete_id,
  summary = false,
  public_ids,
  user_id,
  limit = 1000,
  offset = 0,
}: {
  ids?: number[];
  athlete_id?: string;
  summary?: boolean;
  public_ids?: number[];
  user_id?: string;
  limit?: number;
  offset?: number;
}) {


  if (!athlete_id && !ids && !summary && !public_ids && !user_id) {

  }

  let result;

  if (public_ids) {

    result = await db
      .select()
      .from(activities)
      .where(inArray(activities.public_id, public_ids))
      .orderBy(desc(activities.start_date_local));
  } else if (user_id) {

    const user = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, user_id),
    });
    if (!user) throw new Error('User not found');

    const userAccount = await db.query.accounts.findFirst({
      where: (accounts, { eq }) => eq(accounts.userId, user_id),
    });
    if (!userAccount) throw new Error('Account not found');



    result = await db
      .select()
      .from(activities)
      .where(eq(activities.athlete, parseInt(userAccount.providerAccountId)))
      .orderBy(desc(activities.start_date_local))
      .limit(limit)
      .offset(offset);
  } else if (athlete_id) {

    result = await db
      .select()
      .from(activities)
      .where(eq(activities.athlete, parseInt(athlete_id)))
      .orderBy(desc(activities.start_date_local))
      .limit(limit)
      .offset(offset);
  } else if (ids) {

    result = await db
      .select()
      .from(activities)
      .where(inArray(activities.id, ids));
  } else {

    result = await db.select().from(activities);
  }



  return result;
}

export async function getPhotos() {
  const account = await getAccount({});
  if (!account) throw new Error('No account found');
  return db
    .select()
    .from(photos)
    .where(eq(photos.athlete_id, parseInt(account.providerAccountId)));
}
