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
  
  console.log(`[Webhook] Processing ${aspect_type} event for ${object_type} ${object_id} (owner: ${owner_id})`);
  
  // Only process activity events for now
  if (object_type !== 'activity') {
    console.log(`[Webhook] Ignoring non-activity event: ${object_type}`);
    return;
  }
  
  try {
    // Find the user account associated with this athlete ID
    console.log(`[Webhook] Looking up account for athlete ID: ${owner_id}`);
    let account;
    try {
      account = await getAccount({
        providerAccountId: owner_id.toString()
      });
      
      if (!account) {
        console.error(`[Webhook] No account found for athlete ID: ${owner_id}`);
        return;
      }
    } catch (accountError) {
      console.error(`[Webhook] Error getting account for athlete ID: ${owner_id}:`, accountError);
      return;
    }
    
    console.log(`[Webhook] Found account for athlete ID: ${owner_id}`);
    console.log(`[Webhook] Access token available: ${!!account.access_token}, Refresh token available: ${!!account.refresh_token}`);
    
    let client;
    try {
      // Add token refresh callback to update tokens in database
      client = StravaClient.withTokens(
        account.access_token ?? '', 
        account.refresh_token ?? '',
        async (_tokens) => {
          console.log(`[Webhook] Tokens refreshed during webhook processing`);
          // We don't need to update the database here as getAccount already handles this
        }
      );
    } catch (clientError) {
      console.error(`[Webhook] Error creating Strava client:`, clientError);
      return;
    }
    
    if (aspect_type === 'create' || aspect_type === 'update') {
      // Fetch the activity details from Strava
      console.log(`[Webhook] Fetching activity ${object_id} from Strava`);
      let stravaActivity;
      try {
        // Add timeout to prevent hanging in serverless environment
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        // Wrap the API call in a Promise.race to handle timeouts explicitly
        const fetchPromise = client.getActivity(object_id);
        console.log(`[Webhook] API request initiated for activity ${object_id}`);
        
        // Use Promise.race to handle potential timeouts
        stravaActivity = await Promise.race([
          fetchPromise,
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`[Webhook] Timeout fetching activity ${object_id} from Strava`));
            }, 15000); // 15 second timeout as backup
          })
        ]);
        
        clearTimeout(timeoutId);
        console.log(`[Webhook] API request completed for activity ${object_id}`);
        
        if (!stravaActivity) {
          console.error(`[Webhook] Failed to fetch activity ${object_id} from Strava - null response`);
          return;
        }
      } catch (apiError) {
        console.error(`[Webhook] Error fetching activity ${object_id} from Strava:`, apiError);
        if (apiError instanceof Error) {
          console.error(`[Webhook] Error name: ${apiError.name}, message: ${apiError.message}`);
          console.error(`[Webhook] Error stack: ${apiError.stack}`);
        }
        return;
      }
      
      console.log(`[Webhook] Successfully fetched activity ${object_id} from Strava`);
      
      // Transform and save/update the activity
      console.log(`[Webhook] Transforming activity data`);
      const activity = transformStravaActivity(stravaActivity);
      
      // Add the athlete ID from the owner_id
      const activityWithAthlete = {
        ...activity,
        athlete: owner_id,
      };
      
      console.log(`[Webhook] Saving activity ${object_id} to database`);
      try {
        // Log the activity data structure (without sensitive data)
        console.log(`[Webhook] Activity data structure:`, {
          id: activityWithAthlete.id,
          name: activityWithAthlete.name,
          sport_type: activityWithAthlete.sport_type,
          start_date: activityWithAthlete.start_date,
          athlete: activityWithAthlete.athlete,
          has_map_polyline: !!activityWithAthlete.map_polyline,
          has_map_summary_polyline: !!activityWithAthlete.map_summary_polyline,
          photo_count: activityWithAthlete.photo_count ?? 0,
          total_photo_count: activityWithAthlete.total_photo_count ?? 0,
          is_complete: activityWithAthlete.is_complete ?? false
        });
        
        await db
          .insert(activities)
          .values(activityWithAthlete)
          .onConflictDoUpdate({
            target: activities.id,
            set: activityWithAthlete,
          });
        console.log(`[Webhook] Successfully saved activity ${object_id} to database`);
      } catch (dbError) {
        console.error(`[Webhook] Database error while saving activity ${object_id}:`, dbError);
        // Log more details about the error
        if (dbError instanceof Error) {
          console.error(`[Webhook] Error name: ${dbError.name}, message: ${dbError.message}`);
          console.error(`[Webhook] Error stack: ${dbError.stack}`);
        }
        throw dbError;
      }
      
      console.log(`[Webhook] Successfully processed ${aspect_type} event for activity ${object_id}`);
    } else if (aspect_type === 'delete') {
      // Handle activity deletion
      console.log(`[Webhook] Processing delete event for activity ${object_id}`);
      try {
        // For now, we'll just log it - in a real app you might want to mark it as deleted or remove it
        console.log(`[Webhook] Activity ${object_id} was deleted`);
      } catch (dbError) {
        console.error(`[Webhook] Error handling activity deletion:`, dbError);
        throw dbError;
      }
    }
  } catch (error) {
    console.error(`[Webhook] Error processing ${aspect_type} event for ${object_type} ${object_id}:`, error);
    throw error; // Re-throw to be caught by the caller
  }
}
