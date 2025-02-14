'use server';

import { inArray, eq, count, desc } from 'drizzle-orm';
import { type Activity, activities, photos, accounts } from './schema';
import { db } from './index';
import { auth } from '~/auth';
import { range } from 'd3';
import type { AdapterAccount } from 'next-auth/adapters';

// Use the AdapterAccount type from next-auth
export type Account = AdapterAccount;

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
  const resolvedUserId = userId ?? (await getUser()).id;

  let account = providerAccountId
    ? await db.query.accounts.findFirst({
        where: (accounts, { eq }) =>
          eq(accounts.providerAccountId, providerAccountId),
      })
    : await db.query.accounts.findFirst({
        where: (accounts, { eq }) => eq(accounts.userId, resolvedUserId),
      });

  if (!account) throw new Error('Account not found');

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
      account = {
        ...account,
        access_token: tokens.access_token as string,
        expires_at: newExpiresAt,
        refresh_token:
          (tokens.refresh_token as string) ?? account.refresh_token,
      };

      console.log('Updating account with new tokens:', {
        expires_at: account.expires_at,
        expires_in_seconds: account.expires_at - currentTime,
        has_access_token: !!account.access_token,
        has_refresh_token: !!account.refresh_token,
      });

      await db
        .insert(accounts)
        .values(account)
        .onConflictDoUpdate({
          target: [accounts.provider, accounts.providerAccountId],
          set: account,
        });
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
}: {
  ids?: number[];
  athlete_id?: string;
  summary?: boolean;
}) {
  if (!athlete_id && !ids && !summary) {
    const account = await getAccount({});
    athlete_id = account.providerAccountId;
  }

  return athlete_id
    ? await db
        .select()
        .from(activities)
        .where(eq(activities.athlete, parseInt(athlete_id)))
        .orderBy(desc(activities.start_date_local))
    : ids
      ? await db.select().from(activities).where(inArray(activities.id, ids))
      : await db.select().from(activities);
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
  return db
    .select()
    .from(photos)
    .where(eq(photos.athlete_id, parseInt(account.providerAccountId)));
}
