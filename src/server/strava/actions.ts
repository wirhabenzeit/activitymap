'use server';

import { ne } from 'drizzle-orm';
import { headers } from 'next/headers';

import * as activitiesService from '~/server/application/activities';
import { requireActor } from '~/server/auth/actor';
import { requireAdmin } from '~/server/auth/admin';
import { requireExternalEffectsEnabled } from '~/server/config/external-effects';
import { db } from '~/server/db';
import { stravaWebhooks } from '~/server/db/schema';
import { logger } from '~/server/logging/logger';

import { StravaClient } from './client';
import { type UpdateActivityInput } from './validators';
import { webhookCallbackSecret, webhookCallbackUrl } from './webhook-callback';

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

/**
 * Resolves the secret-bearing callback URL this deployment registers with
 * Strava. Operator-only: the URL embeds `STRAVA_WEBHOOK_CALLBACK_SECRET`,
 * which is the only proof that a webhook delivery came from Strava.
 */
function expectedCallbackUrl(): string {
  if (!process.env.PUBLIC_URL) {
    throw new Error('PUBLIC_URL environment variable is not set');
  }
  const secret = webhookCallbackSecret();
  if (!secret) {
    throw new Error(
      'STRAVA_WEBHOOK_CALLBACK_SECRET is not set or malformed (32-128 characters of A-Z, a-z, 0-9, _ or -)',
    );
  }
  return webhookCallbackUrl(process.env.PUBLIC_URL, secret);
}

/**
 * Operator-only. Reads this Strava app's push subscription and mirrors the
 * one registered for this deployment's secret callback URL into
 * `strava_webhooks`. Calls `requireAdmin()` first: the subscription id and
 * callback URL must never reach other callers.
 */
export async function checkWebhookStatus() {
  await requireAdmin();
  requireExternalEffectsEnabled();

  const expectedUrl = expectedCallbackUrl();
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
        throw new Error(
          'STRAVA_WEBHOOK_VERIFY_TOKEN environment variable is not set',
        );
      }

      await upsertActiveSubscription({
        subscriptionId: matchingSubscription.id,
        verifyToken,
        callbackUrl: matchingSubscription.callback_url,
        resourceState: matchingSubscription.resource_state,
        applicationId: matchingSubscription.application_id,
        createdAt: new Date(matchingSubscription.created_at),
        updatedAt: new Date(matchingSubscription.updated_at),
        verified: true,
      });

      databaseStatus = 'synchronized';
    }

    return {
      hasMatchingSubscription: !!matchingSubscription,
      databaseStatus,
      matchingSubscription: matchingSubscription
        ? { id: matchingSubscription.id }
        : undefined,
      otherSubscriptionCount:
        stravaSubscriptions.length - (matchingSubscription ? 1 : 0),
    };
  } catch (error) {
    logger.error('Failed to manage webhook subscription:', error);
    throw error;
  }
}

/**
 * Operator-only. Ensures this Strava app's single push subscription points
 * at this deployment's secret callback URL. A subscription registered for
 * any other callback (e.g. the legacy unauthenticated `/api/strava/webhook`)
 * is deleted first, because Strava allows one subscription per app; every
 * row for another callback URL is then deactivated so deliveries naming its
 * subscription id are rejected.
 */
export async function createWebhookSubscription() {
  await requireAdmin();
  requireExternalEffectsEnabled();

  const callbackUrl = expectedCallbackUrl();
  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    throw new Error(
      'STRAVA_WEBHOOK_VERIFY_TOKEN environment variable is not set',
    );
  }

  const client = StravaClient.withoutAuth();

  try {
    const existingSubscriptions = await client.getSubscriptions();
    let subscription = existingSubscriptions.find(
      (sub) => sub.callback_url === callbackUrl,
    );

    for (const stale of existingSubscriptions) {
      if (stale.callback_url === callbackUrl) continue;
      await client.deleteSubscription(stale.id);
      logger.info(
        '[Webhook] Deleted Strava subscription for a stale callback URL',
        {
          subscription_id: stale.id,
        },
      );
    }

    const message = subscription
      ? 'Using existing subscription'
      : 'Created new subscription';
    subscription ??= await client.createSubscription(callbackUrl, verifyToken);

    await upsertActiveSubscription({
      subscriptionId: subscription.id,
      verifyToken,
      callbackUrl,
    });
    await db
      .update(stravaWebhooks)
      .set({ active: false, updatedAt: new Date() })
      .where(ne(stravaWebhooks.callbackUrl, callbackUrl));

    return {
      success: true,
      subscription: { id: subscription.id },
      message,
    };
  } catch (error) {
    logger.error('Failed to create webhook subscription:', error);
    return {
      success: false,
      error: 'Webhook subscription failed; see server logs for details.',
    };
  }
}

async function upsertActiveSubscription(
  values: Omit<typeof stravaWebhooks.$inferInsert, 'active'>,
) {
  await db
    .insert(stravaWebhooks)
    .values({ ...values, active: true })
    .onConflictDoUpdate({
      target: stravaWebhooks.callbackUrl,
      set: {
        subscriptionId: values.subscriptionId,
        verifyToken: values.verifyToken,
        resourceState: values.resourceState,
        applicationId: values.applicationId,
        verified: values.verified,
        active: true,
        updatedAt: values.updatedAt ?? new Date(),
      },
    });
}
