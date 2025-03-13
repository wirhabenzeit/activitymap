#!/usr/bin/env tsx

/**
 * Debug script for investigating issues with Strava photo fetching
 * Usage: npx tsx src/scripts/debug-photos.ts <activity_id>
 */

import { StravaClient } from '../server/strava/client';
import { transformStravaPhoto } from '../server/strava/transforms';
import * as dotenv from 'dotenv';
import { db } from '../server/db';
import { accounts } from '../server/db/schema';
import { eq } from 'drizzle-orm';

// Load environment variables
dotenv.config();

async function getStravaToken() {
  // Get token from database - find the first Strava account
  const accountData = await db.query.accounts.findFirst({
    where: eq(accounts.provider, 'strava'),
  });

  if (!accountData?.access_token) {
    throw new Error('No Strava account found in database. Please authenticate with Strava first.');
  }

  return accountData.access_token;
}

async function debugPhotos(activityId: number) {
  try {
    console.log(`Debugging photos for activity ${activityId}...`);
    
    // Get a valid token
    const token = await getStravaToken();
    console.log(`Successfully retrieved token from the database.`);
    
    const client = new StravaClient(token);
    
    // First get the activity to check if it has photos
    const activity = await client.getActivity(activityId);
    console.log(`Activity ${activityId} - ${activity.name}`);
    console.log(`Total photo count: ${activity.total_photo_count}`);
    
    // Output raw activity data
    console.log('\n=== RAW ACTIVITY DATA ===');
    console.log(JSON.stringify(activity, null, 2));
    console.log('=== END RAW ACTIVITY DATA ===\n');
    
    if (activity.total_photo_count === 0) {
      console.log('No photos to fetch');
      process.exit(0);
    }
    
    // Directly fetch raw photos to bypass any processing in the client
    console.log('\nFetching photos directly from API...');
    
    // Make direct fetch for small photos
    const smallPhotosResponse = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}/photos?size=256&photo_sources=true`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    const smallPhotos = await smallPhotosResponse.json();
    
    // Make direct fetch for large photos
    const largePhotosResponse = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}/photos?size=5000&photo_sources=true`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    const largePhotos = await largePhotosResponse.json();
    
    // Display raw photo data
    console.log('\n=== RAW SMALL PHOTOS DATA ===');
    console.log(JSON.stringify(smallPhotos, null, 2));
    console.log('=== END RAW SMALL PHOTOS DATA ===\n');
    
    console.log('\n=== RAW LARGE PHOTOS DATA ===');
    console.log(JSON.stringify(largePhotos, null, 2));
    console.log('=== END RAW LARGE PHOTOS DATA ===\n');
    
    // Now get photos through the client as well
    console.log('\nFetching photos through the client...');
    const photos = await client.getActivityPhotos(activityId);
    
    console.log(`\nFound ${photos.length} photos through client`);
    
    // Check each photo in detail
    console.log('\nPhoto details:');
    photos.forEach((photo, index) => {
      console.log(`\nPhoto ${index + 1} - ID: ${photo.unique_id}`);
      console.log(`Source: ${photo.source}`);
      
      if (photo.urls) {
        console.log('URLs:');
        Object.entries(photo.urls).forEach(([size, url]) => {
          const urlShort = url.length > 60 ? url.substring(0, 57) + '...' : url;
          console.log(`  - ${size}: ${urlShort}`);
        });
      } else {
        console.log('No URLs available');
      }
      
      if (photo.sizes) {
        console.log('Sizes:');
        Object.entries(photo.sizes).forEach(([size, dimensions]) => {
          console.log(`  - ${size}: ${dimensions[0]}x${dimensions[1]}`);
        });
      } else {
        console.log('No size information available');
      }
      
      if (photo.location) {
        console.log(`Location: [${photo.location[0]}, ${photo.location[1]}]`);
      } else {
        console.log('No location data');
      }
      
      // Check if this is likely a placeholder (only has 1800 size)
      const urlKeys = photo.urls ? Object.keys(photo.urls) : [];
      const isPlaceholder = urlKeys.length === 1 && urlKeys[0] === "1800";
      if (isPlaceholder) {
        console.log('** This appears to be a PLACEHOLDER image **');
        
        // Try to get more information about the image URL
        if (photo.urls?.["1800"]) {
          const url = photo.urls["1800"];
          console.log(`Placeholder URL: ${url}`);
          
          // Check if the URL actually contains image data
          const isImageUrl = /\.(jpg|jpeg|png|gif|webp)/i.test(url);
          console.log(`URL appears to be an image: ${isImageUrl}`);
          
          // Check if it's a redirect URL
          if (url.includes('redirect')) {
            console.log('This appears to be a redirect URL, which might explain the placeholder');
          }
        }
      }
      
      // Try transforming the photo
      console.log('\nTransformed photo:');
      const transformed = transformStravaPhoto(photo, 12345); // Dummy athlete ID
      console.log(`  - ID: ${transformed.unique_id}`);
      console.log(`  - Status: ${transformed.status ?? 'normal'}`);
      
      // Verify the image URL by checking for standard image file extensions
      if (photo.urls) {
        for (const [size, url] of Object.entries(photo.urls)) {
          const isImageUrl = /\.(jpg|jpeg|png|gif|webp)/i.test(url);
          console.log(`  - URL (${size}): ${isImageUrl ? 'Valid image' : 'NOT a standard image'}`);
        }
      }
    });
    
  } catch (error) {
    console.error('Error debugging photos:', error);
    process.exit(1);
  }
}

// Get activity ID from command line
const activityId = process.argv[2] ? parseInt(process.argv[2], 10) : null;

if (!activityId) {
  console.error('Please provide an activity ID');
  console.error('Usage: npx tsx src/scripts/debug-photos.ts <activity_id>');
  process.exit(1);
}

// Run the debug function
debugPhotos(activityId).catch(console.error);
