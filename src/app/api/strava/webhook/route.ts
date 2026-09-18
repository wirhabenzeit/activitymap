import { NextResponse, type NextRequest } from 'next/server';
import { db } from '~/server/db';
import { stravaWebhooks } from '~/server/db/schema';
import { eq } from 'drizzle-orm';
import { processWebhookEvent, type StravaWebhookEvent } from '~/server/strava/webhook';
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
 * Strava sends a POST request when an event occurs, with a JSON body containing:
 * - object_type: 'activity' or 'athlete'
 * - object_id: ID of the activity or athlete
 * - aspect_type: 'create', 'update', or 'delete'
 * - owner_id: ID of the athlete who owns the activity
 * - subscription_id: ID of the webhook subscription
 * - event_time: Timestamp of the event
 * - updates: Object containing the updated fields (for 'update' events)
 */
export async function POST(request: NextRequest) {
  try {
    const data = await request.json() as StravaWebhookEvent;
    // `data.updates` may carry a renamed activity title; never log it verbatim.
    const eventId = `${data.object_type}_${data.object_id}_${data.event_time}`;
    logger.info(`[Webhook] Processing event: ${eventId}`, {
      object_type: data.object_type,
      aspect_type: data.aspect_type,
      owner_id: data.owner_id,
      subscription_id: data.subscription_id,
      updated_fields: data.updates ? Object.keys(data.updates) : [],
    });

    try {
      await processWebhookEvent(data);
      logger.info(`[Webhook] Successfully processed event: ${eventId}`);
      return new NextResponse('Event processed successfully', { status: 200 });
    } catch (processingError) {
      logger.error(`[Webhook] Error processing event ${eventId}:`, processingError);
      return new NextResponse('Error processing event', { status: 500 });
    }
  } catch (error) {
    logger.error('Error parsing Strava webhook event:', error);
    return new NextResponse('Invalid event format', { status: 400 });
  }
}
