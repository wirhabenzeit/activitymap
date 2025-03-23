import { NextRequest, NextResponse } from 'next/server';
import { db } from '~/server/db';
import { stravaWebhooks, activities } from '~/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '~/env';
import { StravaClient } from '~/server/strava/client';
import { getAccount } from '~/server/db/actions';
import { transformStravaActivity } from '~/server/strava/transforms';

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
    const data = await request.json() as {
      object_type: string;
      object_id: number;
      aspect_type: string;
      owner_id: number;
      subscription_id: number;
      event_time: number;
      updates?: Record<string, unknown>;
    };
    console.log('Strava webhook event data:', data);
    
    // Always respond with 200 OK immediately to acknowledge receipt
    // Process the event asynchronously to avoid timeouts
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

/**
 * Process a webhook event asynchronously
 */
async function processWebhookEvent(data: {
  object_type: string;
  object_id: number;
  aspect_type: string;
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates?: Record<string, unknown>;
}) {
  const { object_type, object_id, aspect_type, owner_id } = data;
  
  // Only process activity events for now
  if (object_type !== 'activity') {
    console.log(`Ignoring non-activity event: ${object_type}`);
    return;
  }
  
  try {
    // Find the user account associated with this athlete ID
    const account = await getAccount({
      providerAccountId: owner_id.toString()
    });
    
    if (!account) {
      console.error(`No account found for athlete ID: ${owner_id}`);
      return;
    }
    
    const client = StravaClient.withTokens(account.access_token, account.refresh_token);
    
    if (aspect_type === 'create' || aspect_type === 'update') {
      // Fetch the activity details from Strava
      const stravaActivity = await client.getActivity(object_id);
      
      if (!stravaActivity) {
        console.error(`Failed to fetch activity ${object_id} from Strava`);
        return;
      }
      
      // Transform and save/update the activity
      const activity = transformStravaActivity(stravaActivity);
      
      // Add the athlete ID from the owner_id
      const activityWithAthlete = {
        ...activity,
        athlete: owner_id,
      };
      
      await db
        .insert(activities)
        .values(activityWithAthlete)
        .onConflictDoUpdate({
          target: activities.id,
          set: activityWithAthlete,
        });
      
      console.log(`Successfully processed ${aspect_type} event for activity ${object_id}`);
    } else if (aspect_type === 'delete') {
      // Handle activity deletion
      // For now, we'll just log it - in a real app you might want to mark it as deleted
      console.log(`Activity ${object_id} was deleted`);
    }
  } catch (error) {
    console.error(`Error processing ${aspect_type} event for ${object_type} ${object_id}:`, error);
    throw error; // Re-throw to be caught by the caller
  }
}
