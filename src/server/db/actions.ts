'use server';

import { inArray, desc, eq } from 'drizzle-orm';
import { activities } from './schema';
import { db } from './index';
import { headers } from 'next/headers';
import { getUserInternal } from './internal';
import { requireActor } from '~/server/auth/actor';
import * as activitiesService from '~/server/application/activities';

// Safe wrapper for getUser
export const getUser = async (id?: string) => {
  return getUserInternal(id);
};

/**
 * Get activities for a specific user (by internal User ID).
 * If no userId is provided, it attempts to resolve the current authenticated user.
 *
 * Thin compatibility adapter: resolves the caller's `Actor` from the current
 * request context and delegates to the application service
 * (`~/server/application/activities.ts`). The optional `userId` parameter is
 * kept only for call-site compatibility - it was always required to match
 * the authenticated session, so it is now validated against the resolved
 * `Actor` rather than trusted on its own.
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
  const actor = await requireActor(await headers());

  if (userId && userId !== actor.userId) {
    throw new Error('Unauthorized');
  }

  return activitiesService.getUserActivities(actor, { limit, offset });
}

/**
 * Get specific activities by their internal ID, scoped to the caller.
 *
 * Thin compatibility adapter over `getActivitiesForActor`, which enforces
 * ownership - see issue #120. Previously this queried by id with no
 * session/ownership check at all, so any caller who knew or guessed an
 * activity id could fetch it.
 */
export async function getActivitiesByIds(ids: number[]) {
  const actor = await requireActor(await headers());
  return activitiesService.getActivitiesForActor(actor, ids);
}

/**
 * Get specific activities by their Public ID.
 *
 * Intentionally unauthenticated: `public_id` is the sharing identifier for
 * the "share selected activities" flow (see docs/strava-data-policy.md §5).
 * Do not add a session/ownership check here - that would break the existing
 * public sharing behavior, which is deliberately being replaced by #132
 * rather than patched in place.
 */
export async function getPublicActivities(publicIds: number[]) {
  return db
    .select()
    .from(activities)
    .where(inArray(activities.public_id, publicIds))
    .orderBy(desc(activities.start_date));
}

/**
 * Get activities for a shared user profile by internal user ID.
 * This intentionally does not require an authenticated session.
 *
 * Intentionally unauthenticated: this is the "share entire profile" flow
 * (see docs/strava-data-policy.md §5). Do not add a session/ownership check
 * here for the same reason as `getPublicActivities` above.
 */
export async function getPublicUserActivities({
  userId,
  limit = 10000,
  offset = 0,
}: {
  userId: string;
  limit?: number;
  offset?: number;
}) {
  const user = await getUserInternal(userId);
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
 * Get photos for the currently authenticated user.
 *
 * Thin compatibility adapter over `getPhotosForActor`.
 */
export async function getPhotos() {
  const actor = await requireActor(await headers());
  return activitiesService.getPhotosForActor(actor);
}
