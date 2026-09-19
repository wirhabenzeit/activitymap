import { NextResponse, after, type NextRequest } from 'next/server';
import { db } from '~/server/db';
import { stravaWebhooks } from '~/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  findActiveSubscription,
  processInboxEvent,
  recordWebhookEvent,
} from '~/server/strava/webhook';
import { webhookEventSchema } from '~/server/strava/webhook-schema';
import { logger } from '~/server/logging/logger';

/**
 * GET handler for Strava webhook verification
 *
 * Strava sends a GET request to verify the webhook endpoint with the following parameters:
 * - hub.mode: Always 'subscribe'
 * - hub.verify_token: The token we provided when creating the subscription
 * - hub.challenge: A random string that we need to echo back
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  logger.info('Received Strava webhook verification request:', {
    mode,
    hasToken: Boolean(token),
    hasChallenge: Boolean(challenge),
  });

  // Check if the token matches our verification token
  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (verifyToken && token === verifyToken) {
    return NextResponse.json({ 'hub.challenge': challenge });
  }

  // Check if this is a subscription verification request
  if (mode === 'subscribe' && challenge) {
    // Check if the verify token matches one in our database
    if (token) {
      try {
        const webhookRecord = await db.query.stravaWebhooks.findFirst({
          where: eq(stravaWebhooks.verifyToken, token),
        });

        if (webhookRecord) {
          logger.info('Webhook verification successful, responding with challenge');
          // Respond with the challenge to confirm the subscription
          return NextResponse.json({ 'hub.challenge': challenge });
        } else {
          logger.error('Webhook verification failed: unknown verify token');
        }
      } catch (error) {
        logger.error('Database error during webhook verification:', error);
      }
    } else {
      logger.error('No verification token provided');
    }
  } else {
    logger.error('Invalid webhook verification request, missing required parameters');
  }

  // If we get here, something went wrong with the verification
  return new NextResponse('Forbidden', { status: 403 });
}

/**
 * POST handler for Strava webhook events
 *
 * Strava sends a POST request when an event occurs, with a JSON body
 * containing object_type, object_id, aspect_type, owner_id,
 * subscription_id, event_time, and (for updates) an `updates` object.
 *
 * Per issue #124, this handler only validates the delivery, checks it
 * against a known active subscription, and durably inserts it into the
 * webhook inbox before responding — it never calls Strava or mutates
 * activities/photos itself, so the response time never depends on Strava's
 * API latency. A single best-effort processing attempt is scheduled via
 * `after()` to run once the response has been sent, keeping activities
 * updating close to real time; #125 adds real retry/backoff,
 * dead-lettering, and reconciliation on top of these inbox rows.
 */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
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
    logger.error('[Webhook] Rejected event for unknown or inactive subscription:', {
      subscription_id: data.subscription_id,
    });
    return new NextResponse('Unknown or inactive subscription', { status: 403 });
  }

  let eventId: string | null;
  try {
    eventId = await recordWebhookEvent(data);
  } catch (error) {
    logger.error('[Webhook] Failed to durably record event:', error);
    return new NextResponse('Error recording event', { status: 500 });
  }

  if (eventId) {
    after(() => processInboxEvent(eventId));
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
