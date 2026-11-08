import { NextResponse } from 'next/server';
import { logger } from '~/server/logging/logger';

/**
 * Legacy, unauthenticated Strava webhook callback. Strava does not sign
 * deliveries, so anything posted here could have come from anyone; it is no
 * longer accepted. The subscription must be registered with the
 * secret-bearing callback `/api/strava/webhook/<STRAVA_WEBHOOK_CALLBACK_SECRET>`
 * (see `createWebhookSubscription` in `~/server/strava/actions.ts`).
 */
function legacyCallbackRejected(method: string) {
  logger.warn(
    `[Webhook] ${method} to the legacy unauthenticated callback /api/strava/webhook was rejected; re-register the Strava subscription with the secret callback URL`,
  );
  return new NextResponse('Not Found', { status: 404 });
}

export async function GET() {
  return legacyCallbackRejected('GET');
}

export async function POST() {
  return legacyCallbackRejected('POST');
}
