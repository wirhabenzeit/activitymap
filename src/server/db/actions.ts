'use server';

import { inArray, eq, desc } from 'drizzle-orm';
import { activities, photos, accounts } from './schema';
import { db } from './index';
import { auth } from '~/auth';
import type { AdapterAccount } from 'next-auth/adapters';
import { StravaClient, type StravaTokens } from '~/server/strava/client';

// Use the AdapterAccount type from next-auth
export type Account = AdapterAccount;
// Define a type for the account based on the database schema
type AccountType = typeof accounts.$inferSelect;

export const getUser = async (id?: string) => {
  if (!id) {
    const session = await auth();
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
  console.log(`[DB] getAccount called with:`, { providerAccountId, userId, forceRefresh });
  let account: AccountType | null = null;

  try {
    if (providerAccountId) {
      console.log(`[DB] Looking up account by providerAccountId: ${providerAccountId}`);
      const result = await db.query.accounts.findFirst({
        where: (accounts, { eq }) =>
          eq(accounts.providerAccountId, providerAccountId),
      });
      // If account not found by providerAccountId, this is likely a webhook request
      // We should not throw an error, but return null to handle this case appropriately
      if (!result) {
        console.log(`[DB] No account found for providerAccountId: ${providerAccountId}`);
        return null;
      }
      account = result;
      console.log(`[DB] Found account for providerAccountId: ${providerAccountId}`);
    } else if (userId) {
      console.log(`[DB] Looking up account by userId: ${userId}`);
      const result = await db.query.accounts.findFirst({
        where: (accounts, { eq }) => eq(accounts.userId, userId),
      });
      if (result) {
        account = result;
        console.log(`[DB] Found account for userId: ${userId}`);
      } else {
        console.log(`[DB] No account found for userId: ${userId}`);
      }
    } else {
      // Only try to resolve through session if no IDs provided
      console.log(`[DB] No IDs provided, resolving through session`);
      try {
        const resolvedUserId = await getUser().then((user) => user.id);
        console.log(`[DB] Resolved userId from session: ${resolvedUserId}`);
        const result = await db.query.accounts.findFirst({
          where: (accounts, { eq }) => eq(accounts.userId, resolvedUserId),
        });
        if (result) {
          account = result;
          console.log(`[DB] Found account for resolved userId: ${resolvedUserId}`);
        } else {
          console.log(`[DB] No account found for resolved userId: ${resolvedUserId}`);
        }
      } catch (sessionError) {
        console.error(`[DB] Error resolving user from session:`, sessionError);
        throw new Error('Failed to resolve user from session');
      }
    }
  } catch (dbError) {
    console.error(`[DB] Database error in getAccount:`, dbError);
    if (dbError instanceof Error) {
      console.error(`[DB] Error name: ${dbError.name}, message: ${dbError.message}`);
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
    console.log('Token expired or missing expiration, refreshing...');
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

      console.log('Updating account with new tokens:', {
        expires_at: account.expires_at,
        expires_in_seconds: account.expires_at
          ? account.expires_at - currentTime
          : undefined,
        has_access_token: !!account.access_token,
        has_refresh_token: !!account.refresh_token,
      });

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
}: {
  ids?: number[];
  athlete_id?: string;
  summary?: boolean;
  public_ids?: number[];
  user_id?: string;
}) {
  console.log('getActivities called with:', {
    ids,
    athlete_id,
    summary,
    public_ids,
    user_id,
  });

  if (!athlete_id && !ids && !summary && !public_ids && !user_id) {
    console.log('No specific parameters provided, fetching account');
    const account = await getAccount({});
    if (!account) throw new Error('No account found');
    athlete_id = account.providerAccountId;
    console.log('Using athlete_id from account:', athlete_id);
  }

  let result;

  if (public_ids) {
    console.log('Fetching by public_ids:', public_ids);
    result = await db
      .select()
      .from(activities)
      .where(inArray(activities.public_id, public_ids))
      .orderBy(desc(activities.start_date_local));
  } else if (user_id) {
    console.log('Fetching by user_id:', user_id);
    const user = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, user_id),
    });
    if (!user) throw new Error('User not found');

    const userAccount = await db.query.accounts.findFirst({
      where: (accounts, { eq }) => eq(accounts.userId, user_id),
    });
    if (!userAccount) throw new Error('Account not found');

    console.log('Found user account:', {
      userId: user_id,
      providerAccountId: userAccount.providerAccountId,
    });

    result = await db
      .select()
      .from(activities)
      .where(eq(activities.athlete, parseInt(userAccount.providerAccountId)))
      .orderBy(desc(activities.start_date_local));
  } else if (athlete_id) {
    console.log('Fetching by athlete_id:', athlete_id);
    result = await db
      .select()
      .from(activities)
      .where(eq(activities.athlete, parseInt(athlete_id)))
      .orderBy(desc(activities.start_date_local));
  } else if (ids) {
    console.log('Fetching by specific ids:', ids);
    result = await db
      .select()
      .from(activities)
      .where(inArray(activities.id, ids));
  } else {
    console.log('Fetching all activities');
    result = await db.select().from(activities);
  }

  console.log('Query completed:', {
    resultCount: result.length,
    firstActivity: result[0]
      ? {
          id: result[0].id,
          name: result[0].name,
          athlete: result[0].athlete,
        }
      : null,
  });

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
