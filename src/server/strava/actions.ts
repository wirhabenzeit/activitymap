'use server';

import {
  activities as activitySchema,
  activityDeletions,
  stravaWebhooks,
  type Activity,
} from '~/server/db/schema';

import { db } from '~/server/db';
import { getAuthenticatedAccountInternal } from '~/server/db/internal';
import { logger } from '~/server/logging/logger';
import { StravaClient } from './client';
import { transformStravaActivity } from './transforms';
import { type UpdatableActivity } from './types';
import { inArray, eq, and, sql } from 'drizzle-orm';
import {
  updateActivityInputSchema,
  type UpdateActivityInput,
  deleteActivitiesSchema
} from './validators';
import { fetchStravaActivities } from './service';

export async function updateActivity(input: UpdateActivityInput) {
  try {
    const act = updateActivityInputSchema.parse(input);

    // Always resolve the Strava credential from the authenticated session.
    // Never accept a client-supplied access token/account ID here - see issue #116.
    const account = await getAuthenticatedAccountInternal();
    if (!account?.access_token) {
      throw new Error('No Strava access token found');
    }

    const client = StravaClient.withAccessToken(account.access_token);

    try {
      // First update in Strava to ensure we have valid authorization
      const updateData: Omit<UpdatableActivity, 'id' | 'athlete'> = {
        name: act.name,
        sport_type: act.sport_type,
        description: act.description,
        commute: act.commute,
        hide_from_home: act.hide_from_home,
        gear_id: act.gear_id,
      };

      const stravaActivity = await client.updateActivity(act.id, updateData);

      // Transform and update in database
      const transformedActivity = {
        ...transformStravaActivity(stravaActivity),
        athlete: parseInt(account.accountId),
      } satisfies Activity;

      const [updatedActivity] = await db
        .insert(activitySchema)
        .values(transformedActivity)
        .onConflictDoUpdate({
          target: activitySchema.id,
          set: transformedActivity,
        })
        .returning();

      if (!updatedActivity) {
        throw new Error('Failed to update activity in database');
      }

      return updatedActivity;
    } catch (error) {
      logger.error('Failed to update activity:', error);
      throw new Error('Failed to update activity');
    }
  } catch (error) {
    logger.error('Failed to update activity:', error);
    throw new Error('Failed to update activity');
  }
}

/**
 * Re-fetch a single activity (and its photos) from Strava for the
 * authenticated user. This is the only client-callable entry point to the
 * fetchStravaActivities service - it never accepts a caller-supplied token
 * or athlete ID. See issue #116.
 */
export async function refreshActivity(activityId: number) {
  const account = await getAuthenticatedAccountInternal();
  if (!account?.access_token) {
    throw new Error('No Strava access token found');
  }

  return fetchStravaActivities({
    accessToken: account.access_token,
    athleteId: parseInt(account.accountId),
    activityIds: [activityId],
    includePhotos: true,
  });
}

export async function deleteActivities(input: number[]): Promise<{
  deletedCount: number;
  errors: string[];
}> {
  const activityIds = deleteActivitiesSchema.parse(input);
  if (!activityIds || activityIds.length === 0) {
    return { deletedCount: 0, errors: [] };
  }

  const errors: string[] = [];
  let deletedCount = 0;

  try {
    // Get current user's account info to ensure we only delete their activities
    const account = await getAuthenticatedAccountInternal();
    if (!account?.accountId) {
      throw new Error('User account not found or missing accountId');
    }
    const athleteId = parseInt(account.accountId);



    // Perform the deletion
    const deleteResult = await db
      .delete(activitySchema)
      .where(
        and(
          eq(activitySchema.athlete, athleteId),
          inArray(activitySchema.id, activityIds),
        ),
      )
      .returning({ deletedId: activitySchema.id });

    deletedCount = deleteResult.length;

    if (deleteResult.length > 0) {
      await db
        .insert(activityDeletions)
        .values(
          deleteResult.map(({ deletedId }) => ({
            athlete_id: athleteId,
            activity_id: deletedId,
            deleted_at: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [activityDeletions.athlete_id, activityDeletions.activity_id],
          set: {
            deleted_at: sql`excluded.deleted_at`,
          },
        });
    }


    // Check if any requested IDs were not deleted (e.g., didn't belong to the user)
    if (deletedCount < activityIds.length) {
      const deletedSet = new Set(deleteResult.map(r => r.deletedId));
      const notDeleted = activityIds.filter(id => !deletedSet.has(id));
      const errorMsg = `Failed to delete some activities (possible permission issue or already deleted): ${notDeleted.join(', ')}`;
      logger.warn(errorMsg);
      errors.push(errorMsg);
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Error deleting activities:', errorMsg);
    errors.push(`Server error during deletion: ${errorMsg}`);
    // Return partial success if some were deleted before the error
  }

  return { deletedCount, errors };
}

export async function checkWebhookStatus() {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL environment variable is not set');
  }

  const expectedUrl = new URL(
    '/api/strava/webhook',
    process.env.PUBLIC_URL,
  ).toString();

  const client = StravaClient.withoutAuth();

  try {
    const stravaSubscriptions = await client.getSubscriptions();


    const matchingSubscription = stravaSubscriptions.find(
      (sub) => sub.callback_url === expectedUrl,
    );

    let databaseStatus = 'no_matching_subscription';

    if (matchingSubscription) {
      const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
      if (!verifyToken) {
        throw new Error('STRAVA_WEBHOOK_VERIFY_TOKEN environment variable is not set');
      }

      await db
        .insert(stravaWebhooks)
        .values({
          subscriptionId: matchingSubscription.id,
          verifyToken,
          callbackUrl: matchingSubscription.callback_url,
          resourceState: matchingSubscription.resource_state,
          applicationId: matchingSubscription.application_id,
          createdAt: new Date(matchingSubscription.created_at),
          updatedAt: new Date(matchingSubscription.updated_at),
          verified: true,
          active: true,
        })
        .onConflictDoUpdate({
          target: stravaWebhooks.callbackUrl,
          set: {
            subscriptionId: matchingSubscription.id,
            verifyToken,
            resourceState: matchingSubscription.resource_state,
            applicationId: matchingSubscription.application_id,
            updatedAt: new Date(matchingSubscription.updated_at),
            verified: true,
            active: true,
          },
        });

      databaseStatus = 'synchronized';
    }

    return {
      expectedUrl,
      subscriptions: stravaSubscriptions,
      hasMatchingSubscription: !!matchingSubscription,
      databaseStatus,
      matchingSubscription,
    };
  } catch (error) {
    logger.error('Failed to manage webhook subscription:', error);
    throw error;
  }
}

export async function createWebhookSubscription() {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL environment variable is not set');
  }

  const callbackUrl = new URL(
    '/api/strava/webhook',
    process.env.PUBLIC_URL,
  ).toString();

  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

  if (!verifyToken) {
    throw new Error('STRAVA_WEBHOOK_VERIFY_TOKEN environment variable is not set');
  }



  const client = StravaClient.withoutAuth();

  try {
    const existingSubscriptions = await client.getSubscriptions();

    const existingSubscription = existingSubscriptions.find(
      (sub) => sub.callback_url === callbackUrl,
    );

    if (existingSubscription) {


      await db
        .insert(stravaWebhooks)
        .values({
          subscriptionId: existingSubscription.id,
          verifyToken,
          callbackUrl,
          active: true,
        })
        .onConflictDoUpdate({
          target: [stravaWebhooks.callbackUrl],
          set: {
            subscriptionId: existingSubscription.id,
            verifyToken,
            active: true,
            updatedAt: new Date(),
          },
        });

      return {
        success: true,
        subscription: existingSubscription,
        message: 'Using existing subscription',
      };
    }

    const subscription = await client.createSubscription(callbackUrl, verifyToken);


    await db
      .insert(stravaWebhooks)
      .values({
        subscriptionId: subscription.id,
        verifyToken,
        callbackUrl,
        active: true,
      })
      .onConflictDoUpdate({
        target: [stravaWebhooks.callbackUrl],
        set: {
          subscriptionId: subscription.id,
          verifyToken,
          active: true,
          updatedAt: new Date(),
        },
      });

    return {
      success: true,
      subscription,
      message: 'Created new subscription',
    };
  } catch (error) {
    logger.error('Failed to create webhook subscription:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      details: 'Make sure your callback URL is publicly accessible and your Strava API credentials are correct',
    };
  }
}
