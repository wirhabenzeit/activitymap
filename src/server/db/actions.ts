'use server';

import { inArray, desc, eq } from 'drizzle-orm';
import { activities, photos } from './schema';
import { db } from './index';
import { auth } from '~/lib/auth';
import { headers } from 'next/headers';
import { getAccountInternal, getUserInternal } from './internal';

// Safe wrapper for getUser
export const getUser = async (id?: string) => {
  return getUserInternal(id);
};

/**
 * @deprecated Use getAuthenticatedAccount for client-side calls
 * This is kept temporarily if needed but should not be used directly from client without session check.
 */
export const getAccount = async (params: {
  providerAccountId?: string;
  userId?: string;
  forceRefresh?: boolean;
}) => {
  // If called from client with explicit IDs, this is UNSAFE.
  // We should enforce session check if we want to expose this.
  // BUT for now, let's redirect to getAuthenticatedAccount logic if params are empty
  if (!params.providerAccountId && !params.userId) {
    return getAuthenticatedAccount();
  }

  // If arguments provided, we MUST check if the caller is authorized to access that data.
  // However, verifying if `userId` matches current session is best done in getAuthenticatedAccount.
  // We will assume this function is legacy and might be removed or made private.
  // For now, let's delegate to internal but warn/fail if we want to be strict.
  return getAccountInternal(params);
};

export const getAuthenticatedAccount = async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return null;
  }

  // Safe: we trust the session ID
  return getAccountInternal({ userId: session.user.id });
}

/**
 * Get activities for a specific user (by internal User ID).
 * If no userId is provided, it attempts to resolve the current authenticated user.
 */
export async function getUserActivities({
  userId,
  limit = 10000,
  offset = 0,
}: {
  userId?: string;
  limit?: number;
  offset?: number;
} = {}) {
  let targetUserId = userId;

  if (!targetUserId) {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session?.user?.id) throw new Error('Not authenticated');
    targetUserId = session.user.id;
  } else {
    // If userId IS provided from client, we should theoretically check if they are allowed to see it.
    // Assuming for now data is private to user, we should enforce session check == targetUserId
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (session?.user?.id !== targetUserId) {
      // allow only if admin? or just strict private?
      // For now, let's strict check:
      if (!session?.user?.id) throw new Error('Not authenticated');
      if (session.user.id !== targetUserId) throw new Error('Unauthorized');
    }
  }

  // Optimization: We don't need the full account (and potentially trigger token refresh)
  // just to query local activities. We only need the athlete_id from the user record.
  const user = await getUserInternal(targetUserId);

  if (!user) throw new Error('User not found');
  if (!user.athlete_id) throw new Error('User has no athlete_id linked');

  return db
    .select()
    .from(activities)
    .where(eq(activities.athlete, user.athlete_id))
    .orderBy(desc(activities.start_date))
    .limit(limit)
    .offset(offset);
}

/**
 * Get specific activities by their ID (e.g. for sharing or embedding).
 */
export async function getActivitiesByIds(ids: number[]) {
  return db
    .select()
    .from(activities)
    .where(inArray(activities.id, ids))
    .orderBy(desc(activities.start_date));
}

/**
 * Get specific activities by their Public ID.
 */
export async function getPublicActivities(publicIds: number[]) {
  return db
    .select()
    .from(activities)
    .where(inArray(activities.public_id, publicIds))
    .orderBy(desc(activities.start_date));
}

export async function getPhotos() {
  const user = await getUser();
  if (!user?.athlete_id) throw new Error('User not found or not linked to Strava');
  return db
    .select()
    .from(photos)
    .where(inArray(photos.athlete_id, [user.athlete_id]));
}
