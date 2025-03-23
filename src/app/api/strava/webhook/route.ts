import { NextRequest, NextResponse } from 'next/server';
import { db } from '~/server/db';
import { stravaWebhooks } from '~/server/db/schema';
import { eq } from 'drizzle-orm';
import { processWebhookEvent, type StravaWebhookEvent } from '~/server/strava/webhook';

/**
 * GET handler for Strava webhook verification
 * 
 * Strava sends a GET request to verify the webhook endpoint with the following parameters:
 * - hub.mode: Always 'subscribe'
 * - hub.verify_token: The token we provided when creating the subscription
 * - hub.challenge: A random string that we need to echo back
 */
export async function GET(request: NextRequest) {
  console.log('Received Strava webhook verification request');
  
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  
  console.log('Strava webhook verification params:', { mode, token, challenge });
  
  // For debugging: If we're using our fixed token for development
  if (token === 'ygjvd3uc6ff') {
    console.log('Using development verification token');
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
          console.log('Webhook verification successful, responding with challenge');
          
          // Respond with the challenge to confirm the subscription
          return NextResponse.json({ 'hub.challenge': challenge });
        } else {
          console.error('Invalid verification token received:', token);
        }
      } catch (error) {
        console.error('Database error during webhook verification:', error);
      }
    } else {
      console.error('No verification token provided');
    }
  } else {
    console.error('Invalid webhook verification request, missing required parameters');
  }
  
  // If we get here, something went wrong with the verification
  console.error('Webhook verification failed');
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
  console.log('Received Strava webhook event');
  
  try {
    const data = await request.json() as StravaWebhookEvent;
    console.log('Strava webhook event data:', data);
    
    // Always respond with 200 OK immediately to acknowledge receipt
    // Process the event asynchronously to avoid timeouts
    // This follows the separation of concerns pattern where API routes handle HTTP concerns
    // and server actions handle business logic
    processWebhookEvent(data).catch(error => {
      console.error('Error processing webhook event:', error);
    });
    
    return new NextResponse('Event received', { status: 200 });
  } catch (error) {
    console.error('Error parsing Strava webhook event:', error);
    // Still return 200 to avoid Strava retrying with the same invalid data
    return new NextResponse('Invalid event format', { status: 200 });
  }
}
