import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse, after } from 'next/server';

import { db } from '~/server/db';
import { stravaWebhooks } from '~/server/db/schema';
import { logger } from '~/server/logging/logger';
import {
  type RecordedWebhookEvent,
  findActiveSubscription,
  isRegisteredStravaAthlete,
  processInboxEvent,
  recordWebhookEvent,
} from '~/server/strava/webhook';
import {
  WEBHOOK_MAX_BODY_BYTES,
  webhookEventSchema,
} from '~/server/strava/webhook-schema';

/**
 * Strava webhook verification (GET) and delivery (POST) logic. Only the
 * authenticated `/api/strava/webhook/[key]` route calls these, after it has
 * checked the callback secret; see `~/server/strava/webhook-callback.ts`.
 *
 * Strava sends a GET request to verify the webhook endpoint with:
 * - hub.mode: Always 'subscribe'
 * - hub.verify_token: The token we provided when creating the subscription
 * - hub.challenge: A random string that we need to echo back
 */
export async function handleWebhookVerification(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  logger.info('Received Strava webhook verification request:', {
    mode,
    hasToken: Boolean(token),
    hasChallenge: Boolean(challenge),
  });

  if (mode !== 'subscribe' || !challenge || !token) {
    logger.error(
      'Invalid webhook verification request, missing required parameters',
    );
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Check if the token matches our verification token
  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (verifyToken && token === verifyToken) {
    return NextResponse.json({ 'hub.challenge': challenge });
  }

  try {
    const webhookRecord = await db.query.stravaWebhooks.findFirst({
      where: eq(stravaWebhooks.verifyToken, token),
    });
    if (webhookRecord) {
      logger.info('Webhook verification successful, responding with challenge');
      return NextResponse.json({ 'hub.challenge': challenge });
    }
    logger.error('Webhook verification failed: unknown verify token');
  } catch (error) {
    logger.error('Database error during webhook verification:', error);
  }

  return new NextResponse('Forbidden', { status: 403 });
}

/**
 * Strava sends a POST request when an event occurs, with a JSON body
 * containing object_type, object_id, aspect_type, owner_id,
 * subscription_id, event_time, and (for updates) an `updates` object.
 *
 * Per issue #124, this handler only validates the delivery, checks it
 * against a known active subscription and a registered athlete, and durably
 * inserts it into the webhook inbox before responding — it never calls Strava or mutates
 * activities/photos itself, so the response time never depends on Strava's
 * API latency. A single best-effort processing attempt is scheduled via
 * `after()` to run once the response has been sent, keeping activities
 * updating close to real time; #125 adds real retry/backoff,
 * dead-lettering, and reconciliation on top of these inbox rows.
 */
export async function handleWebhookDelivery(request: NextRequest) {
  // Strava deliveries are a few hundred bytes. Reject anything larger before
  // buffering it, and again after reading for bodies sent without a
  // Content-Length (chunked).
  const declaredLength = Number(request.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > WEBHOOK_MAX_BODY_BYTES
  ) {
    return new NextResponse('Payload too large', { status: 413 });
  }

  let json: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > WEBHOOK_MAX_BODY_BYTES) {
      return new NextResponse('Payload too large', { status: 413 });
    }
    json = JSON.parse(text);
  } catch (error) {
    logger.error('Error parsing Strava webhook event:', error);
    return new NextResponse('Invalid event format', { status: 400 });
  }

  const parsed = webhookEventSchema.safeParse(json);
  if (!parsed.success) {
    logger.error('Invalid Strava webhook event payload:', parsed.error.message);
    return new NextResponse('Invalid event format', { status: 400 });
  }
  const data = parsed.data;

  // `data.updates` may carry a renamed activity title; never log it verbatim.
  logger.info('[Webhook] Received event', {
    object_type: data.object_type,
    aspect_type: data.aspect_type,
    owner_id: data.owner_id,
    subscription_id: data.subscription_id,
    updated_fields: data.updates ? Object.keys(data.updates) : [],
  });

  const subscription = await findActiveSubscription(data.subscription_id);
  if (!subscription) {
    logger.error(
      '[Webhook] Rejected event for unknown or inactive subscription:',
      {
        subscription_id: data.subscription_id,
      },
    );
    return new NextResponse('Unknown or inactive subscription', {
      status: 403,
    });
  }

  let recorded: RecordedWebhookEvent | null;
  try {
    // Acknowledge, but never store, events for athletes without an
    // ActivityMap account: Strava only needs the 200, and anything other
    // than 2xx makes it redeliver.
    if (!(await isRegisteredStravaAthlete(data.owner_id))) {
      logger.info('[Webhook] Ignored event for an unregistered athlete', {
        object_type: data.object_type,
        aspect_type: data.aspect_type,
        owner_id: data.owner_id,
      });
      return new NextResponse('Event received', { status: 200 });
    }
    recorded = await recordWebhookEvent(data);
  } catch (error) {
    logger.error('[Webhook] Failed to durably record event:', error);
    return new NextResponse('Error recording event', { status: 500 });
  }

  if (recorded) {
    after(() => processInboxEvent(recorded.id, recorded.payload));
  } else {
    logger.info('[Webhook] Duplicate delivery ignored', {
      object_type: data.object_type,
      object_id: data.object_id,
      aspect_type: data.aspect_type,
      event_time: data.event_time,
    });
  }

  return new NextResponse('Event received', { status: 200 });
}
