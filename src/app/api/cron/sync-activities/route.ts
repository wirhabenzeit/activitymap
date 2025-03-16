import { syncActivities } from '~/server/strava/sync';
import { type NextRequest, NextResponse } from 'next/server';

// Define type for configuration options
interface SyncConfig {
  maxIncompleteActivities?: number;
  maxOldActivities?: number;
  minActivitiesThreshold?: number;
}

/**
 * API endpoint for syncing Strava activities via a cron job
 * 
 * Configuration parameters:
 * - maxIncompleteActivities: Maximum number of incomplete activities to update per run (default: 30)
 * - maxOldActivities: Maximum number of old activities to fetch per run (default: 30)
 * - minActivitiesThreshold: Minimum number of activities to detect reaching oldest (default: 2)
 * 
 * Authentication:
 * - Requires CRON_SECRET to be set in the environment variables
 * - Request must include 'x-cron-secret' header with the matching secret value
 * 
 * @returns HTTP 200 if successful, with details of activities updated
 * @returns HTTP 401 if authentication fails
 * @returns HTTP 500 if an error occurs
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate the request
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error('CRON_SECRET is not set in environment variables');
      return NextResponse.json(
        { error: 'CRON_SECRET is not configured' },
        { status: 500 }
      );
    }

    const providedSecret = request.headers.get('x-cron-secret');
    if (providedSecret !== cronSecret) {
      console.error('Invalid cron secret provided');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse configuration from request body, if provided
    const requestBody: Record<string, unknown> = {};
    try {
      // Use a type guard to ensure we have a valid object
      const parsedBody: unknown = await request.json();
      
      // Type guard to verify parsedBody is a valid object
      function isValidObject(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
      }
      
      if (isValidObject(parsedBody)) {
        // Type guards for individual properties
        if ('maxIncompleteActivities' in parsedBody && 
            typeof parsedBody.maxIncompleteActivities === 'number') {
          requestBody.maxIncompleteActivities = parsedBody.maxIncompleteActivities;
        }
        
        if ('maxOldActivities' in parsedBody && 
            typeof parsedBody.maxOldActivities === 'number') {
          requestBody.maxOldActivities = parsedBody.maxOldActivities;
        }
        
        if ('minActivitiesThreshold' in parsedBody && 
            typeof parsedBody.minActivitiesThreshold === 'number') {
          requestBody.minActivitiesThreshold = parsedBody.minActivitiesThreshold;
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_) {
      console.log('Failed to parse request body, using defaults');
    }

    // Type-safe extraction of config values
    const config: SyncConfig = {
      maxIncompleteActivities: typeof requestBody.maxIncompleteActivities === 'number' ? requestBody.maxIncompleteActivities : undefined,
      maxOldActivities: typeof requestBody.maxOldActivities === 'number' ? requestBody.maxOldActivities : undefined,
      minActivitiesThreshold: typeof requestBody.minActivitiesThreshold === 'number' ? requestBody.minActivitiesThreshold : undefined,
    };
    
    // Run the sync process
    const result = await syncActivities({
      maxIncompleteActivities: config.maxIncompleteActivities ?? 30,
      maxOldActivities: config.maxOldActivities ?? 30,
      minActivitiesThreshold: config.minActivitiesThreshold ?? 2,
    });

    // Return the results
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error syncing activities:', error);
    return NextResponse.json(
      { 
        error: 'Failed to sync activities',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
