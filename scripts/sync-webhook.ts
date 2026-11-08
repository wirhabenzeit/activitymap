import { StravaClient } from '../src/server/strava/client';
import {
  webhookCallbackSecret,
  webhookCallbackUrl,
} from '../src/server/strava/webhook-callback';

/**
 * Operator script: reports whether this Strava app's push subscription points
 * at the secret callback URL. It never prints the secret. To create or
 * replace the subscription, use the admin-only `createWebhookSubscription`
 * action.
 */
async function main() {
  try {
    const publicUrl = process.env.PUBLIC_URL;
    const secret = webhookCallbackSecret();
    if (!publicUrl || !secret) {
      throw new Error(
        'PUBLIC_URL and a valid STRAVA_WEBHOOK_CALLBACK_SECRET must be set',
      );
    }
    const expectedUrl = webhookCallbackUrl(publicUrl, secret);
    const subscriptions = await StravaClient.withoutAuth().getSubscriptions();
    const matching = subscriptions.find(
      (sub) => sub.callback_url === expectedUrl,
    );

    console.log('Strava subscriptions for this app:', subscriptions.length);
    console.log('- Points at the secret callback URL:', Boolean(matching));
    if (matching) console.log('- Subscription id:', matching.id);
    const stale = subscriptions.filter((sub) => sub !== matching);
    if (stale.length > 0) {
      console.log(
        '- Subscriptions for another callback URL (replace via createWebhookSubscription):',
        stale.map((sub) => sub.id),
      );
    }
  } catch (error) {
    console.error('Error checking webhook subscription:', error);
  } finally {
    process.exit(0);
  }
}

main().catch(console.error);
