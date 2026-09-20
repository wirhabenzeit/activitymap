'use server';

import { stravaWebhooks } from '~/server/db/schema';

import { db } from '~/server/db';
import { logger } from '~/server/logging/logger';
import { StravaClient } from './client';
import { type UpdateActivityInput } from './validators';
import { requireExternalEffectsEnabled } from '~/server/config/external-effects';
import { headers } from 'next/headers';
import { requireActor } from '~/server/auth/actor';
import * as activitiesService from '~/server/application/activities';

/**
 * Thin compatibility adapter: resolves the caller's `Actor` from the current
 * request context and delegates to the application service
 * (`~/server/application/activities.ts`), which resolves the Strava
 * credential itself and enforces ownership. Never accepts a client-supplied
 * access token/account ID here - see issue #116.
 */
export async function updateActivity(input: UpdateActivityInput) {
  const actor = await requireActor(await headers());
  return activitiesService.updateActivityForActor(actor, input);
}

/**
 * Re-fetch a single activity (and its photos) from Strava for the
 * authenticated user. This is the only client-callable entry point to the
 * fetchStravaActivities service - it never accepts a caller-supplied token
 * or athlete ID. See issue #116.
 *
 * Thin compatibility adapter over `refreshActivityForActor`.
 */
export async function refreshActivity(activityId: number) {
  const actor = await requireActor(await headers());
  return activitiesService.refreshActivityForActor(actor, activityId);
}

/**
 * Thin compatibility adapter over `deleteActivitiesForActor`.
 */
export async function deleteActivities(input: number[]): Promise<{
  deletedCount: number;
  errors: string[];
}> {
  const actor = await requireActor(await headers());
  return activitiesService.deleteActivitiesForActor(actor, input);
}

export async function checkWebhookStatus() {
  requireExternalEffectsEnabled();

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
  requireExternalEffectsEnabled();

  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL environment variable is not set');
  }

  const callbackUrl = new URL(
    '/api/strava/webhook',
    process.env.PUBLIC_URL,
  ).toString();

  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

  if (!verifyToken) {
    throw new Error(
      'STRAVA_WEBHOOK_VERIFY_TOKEN environment variable is not set',
    );
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

    const subscription = await client.createSubscription(
      callbackUrl,
      verifyToken,
    );

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
      details:
        'Make sure your callback URL is publicly accessible and your Strava API credentials are correct',
    };
  }
}
