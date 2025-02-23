'use server';

import { inArray, eq, count, desc } from 'drizzle-orm';
import { type Activity, activities, photos, accounts } from './schema';
import { db } from './index';
import { auth } from '~/auth';
import { range } from 'd3';
import type { AdapterAccount } from 'next-auth/adapters';

// Use the AdapterAccount type from next-auth
export type Account = AdapterAccount;

export const getUserByStravaId = async (stravaId: string) => {
  const account = await db.query.accounts.findFirst({
    where: (accounts, { eq }) => eq(accounts.providerAccountId, stravaId),
  });
  if (!account) throw new Error('Account not found');

  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, account.userId),
  });
  if (!user) throw new Error('User not found');

  return user;
};

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
  let account;

  if (providerAccountId) {
    account = await db.query.accounts.findFirst({
      where: (accounts, { eq }) =>
        eq(accounts.providerAccountId, providerAccountId),
    });
    // If account not found by providerAccountId, this is likely a webhook request
    // We should not throw an error, but return null to handle this case appropriately
    if (!account) return null;
  } else if (userId) {
    account = await db.query.accounts.findFirst({
      where: (accounts, { eq }) => eq(accounts.userId, userId),
    });
  } else {
    // Only try to resolve through session if no IDs provided
    const resolvedUserId = await getUser().then((user) => user.id);
    account = await db.query.accounts.findFirst({
      where: (accounts, { eq }) => eq(accounts.userId, resolvedUserId),
    });
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
      const response = await fetch(
        'https://www.strava.com/api/v3/oauth/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: process.env.AUTH_STRAVA_ID,
            client_secret: process.env.AUTH_STRAVA_SECRET,
            grant_type: 'refresh_token',
            refresh_token: account.refresh_token,
          }),
        },
      );

      const tokens = (await response.json()) as Record<string, unknown>;
      console.log('Token refresh response:', {
        status: response.status,
        ok: response.ok,
        tokens: {
          expires_in: tokens.expires_in,
          token_type: tokens.token_type,
          has_access_token: !!tokens.access_token,
          has_refresh_token: !!tokens.refresh_token,
        },
      });

      if (!response.ok) throw tokens;

      const newExpiresAt = Math.floor(
        currentTime + (tokens.expires_in as number),
      );
      const updatedAccount = {
        ...account,
        access_token: tokens.access_token as string,
        expires_at: newExpiresAt,
        refresh_token:
          (tokens.refresh_token as string) ?? account.refresh_token,
      };

      console.log('Updating account with new tokens:', {
        expires_at: updatedAccount.expires_at,
        expires_in_seconds: updatedAccount.expires_at - currentTime,
        has_access_token: !!updatedAccount.access_token,
        has_refresh_token: !!updatedAccount.refresh_token,
      });

      await db
        .insert(accounts)
        .values(updatedAccount)
        .onConflictDoUpdate({
          target: [accounts.provider, accounts.providerAccountId],
          set: updatedAccount,
        });

      return updatedAccount;
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

export async function getActivitiesPaged({
  athlete_id,
  pageSize = 100,
}: {
  athlete_id?: string;
  pageSize: number;
}) {
  if (!athlete_id) {
    const account = await getAccount({});
    if (!account) throw new Error('No account found');
    athlete_id = account.providerAccountId;
  }

  return db
    .select()
    .from(activities)
    .where(eq(activities.athlete, parseInt(athlete_id)))
    .orderBy(desc(activities.start_date_local));
}

export async function getPhotos() {
  const account = await getAccount({});
  if (!account) throw new Error('No account found');
  return db
    .select()
    .from(photos)
    .where(eq(photos.athlete_id, parseInt(account.providerAccountId)));
}
