'use server';

import { requireAdmin } from '~/server/auth/admin';
import { requireExternalEffectsEnabled } from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';

import { StravaClient } from './client';
import { webhookCallbackSecret, webhookCallbackUrl } from './webhook-callback';

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
 * Operator-only. Reads this Strava app's push subscriptions and reports
 * whether one is registered for this deployment's secret callback URL.
 * Calls `requireAdmin()` first: the subscription id and callback URL must
 * never reach other callers.
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

    return {
      hasMatchingSubscription: !!matchingSubscription,
      // Kept for the controls that read it: there is nothing to synchronize.
      databaseStatus: matchingSubscription
        ? 'synchronized'
        : 'no_matching_subscription',
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
