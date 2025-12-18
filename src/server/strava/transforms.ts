import polyline from '@mapbox/polyline';
import type { Activity, Photo } from '~/server/db/schema';
import type { StravaActivity, StravaPhoto } from './types';

export function transformStravaActivity(
  activity: StravaActivity,
  isComplete = false,
): Omit<Activity, 'athlete'> {
  const start_date = new Date(activity.start_date);
  const local_date = new Date(
    start_date.toLocaleString('en-US', {
      timeZone: activity.timezone.split(' ').pop(),
    }),
  );

  let bbox: [number, number, number, number] = [0, 0, 0, 0];
  if (activity.map?.summary_polyline) {
    const coordinates = polyline.decode(activity.map.summary_polyline).map(
      ([lat, lon]) => [lon, lat] as [number, number],
    );
    bbox = coordinates.reduce(
      (acc, coord) => [
        Math.min(acc[0], coord[0]),
        Math.min(acc[1], coord[1]),
        Math.max(acc[2], coord[0]),
        Math.max(acc[3], coord[1]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
  }

  // Generate a deterministic public_id based on the activity ID
  // Using FNV-1a hash function modified to produce a positive bigint
  const fnv1a = (str: string) => {
    const prime = BigInt(0x00000100000001b3);
    let hash = BigInt(0xcbf29ce484222325);
    const uint64_max = BigInt('9223372036854775807'); // max safe bigint in postgres

    for (let i = 0; i < str.length; i++) {
      hash = hash ^ BigInt(str.charCodeAt(i));
      hash = (hash * prime) % uint64_max;
    }

    return Number(hash);
  };

  const public_id = fnv1a(`strava_${activity.id}_${activity.athlete.id}`);

  return {
    id: activity.id,
    public_id,
    name: activity.name,
    description: activity.description,
    distance: activity.distance,
    moving_time: activity.moving_time,
    elapsed_time: activity.elapsed_time,
    total_elevation_gain: activity.total_elevation_gain,
    sport_type: activity.sport_type,
    start_date,
    start_date_local: local_date,
    timezone: activity.timezone,
    start_latlng: activity.start_latlng,
    end_latlng: activity.end_latlng,
    achievement_count: activity.achievement_count,
    kudos_count: activity.kudos_count,
    comment_count: activity.comment_count,
    athlete_count: activity.athlete_count,
    photo_count: activity.photo_count,
    total_photo_count: activity.total_photo_count,
    map_id: activity.map.id,
    map_polyline: activity.map.polyline,
    map_summary_polyline: activity.map.summary_polyline,
    map_bbox: bbox,
    trainer: activity.trainer,
    commute: activity.commute,
    manual: activity.manual,
    private: activity.private,
    flagged: activity.flagged,
    workout_type: activity.workout_type,
    upload_id: activity.upload_id,
    average_speed: activity.average_speed,
    max_speed: activity.max_speed,
    has_kudoed: activity.has_kudoed,
    hide_from_home: activity.hide_from_home,
    gear_id: activity.gear_id,
    device_watts: activity.device_watts,
    average_watts: activity.average_watts,
    max_watts: activity.max_watts,
    weighted_average_watts: activity.weighted_average_watts,
    kilojoules: activity.kilojoules,
    elev_high: activity.elev_high,
    elev_low: activity.elev_low,
    has_heartrate: false,
    average_heartrate: null,
    max_heartrate: null,
    heartrate_opt_out: false,
    display_hide_heartrate_option: false,
    calories: activity.calories,
    pr_count: activity.pr_count,
    last_updated: new Date(),
    is_complete: isComplete,
  };
}

/**
 * Merge and process photos from different Strava API endpoints
 * This handles combining small and large photo data and filtering out placeholders
 */
export function mergeAndProcessStravaPhotos(
  smallPhotos: StravaPhoto[],
  largePhotos: StravaPhoto[]
): StravaPhoto[] {
  // Create maps for faster lookup
  const smallPhotoMap = new Map(smallPhotos.map(p => [p.unique_id, p]));
  const largePhotoMap = new Map(largePhotos.map(p => [p.unique_id, p]));

  // Get all unique photo IDs
  const allPhotoIds = Array.from(new Set([
    ...smallPhotos.map(p => p.unique_id),
    ...largePhotos.map(p => p.unique_id)
  ]));

  // Merge photos based on ID rather than index
  const mergedPhotos: StravaPhoto[] = [];

  for (const photoId of allPhotoIds) {
    const smallPhoto = smallPhotoMap.get(photoId);
    const largePhoto = largePhotoMap.get(photoId);

    if (!smallPhoto && !largePhoto) {

      continue;
    }

    // Use large photo as base if available, otherwise use small
    const basePhoto = largePhoto ?? smallPhoto!;

    // Special case: Check if the photo is a special size (like 1800)
    const specialSize = basePhoto.urls &&
      basePhoto.urls["256"] === undefined &&
      basePhoto.urls["5000"] === undefined;

    if (specialSize) {


      // For special size photos, check if this appears to be a placeholder
      // Primary detection: Look for "placeholder" in the URL
      let isPlaceholder = false;

      if (basePhoto.urls) {
        // Check all URLs for the word "placeholder"
        for (const url of Object.values(basePhoto.urls)) {
          if (url.includes('placeholder')) {
            isPlaceholder = true;

            break;
          }
        }
      }

      // Fallback detection: Check for special size pattern
      const urlKeys = basePhoto.urls ? Object.keys(basePhoto.urls) : [];
      if (!isPlaceholder && urlKeys.length === 1 && urlKeys[0] === "1800") {
        isPlaceholder = true;

      }

      if (isPlaceholder) {
        // Skip placeholder images - don't include them in the results

        continue;
      }
    }

    // Normal case: Merge small and large photo data
    const merged = {
      ...basePhoto,
      urls: {
        ...(smallPhoto?.urls ?? {}),
        ...(largePhoto?.urls ?? {})
      },
      sizes: {
        ...(smallPhoto?.sizes ?? {}),
        ...(largePhoto?.sizes ?? {})
      },
    };

    if (mergedPhotos.length === 0) {

    }

    mergedPhotos.push(merged);
  }

  return mergedPhotos;
}

/**
 * Transform a Strava photo to our database schema format
 * Handles validation and filtering of placeholder images
 */
export function transformStravaPhoto(
  photo: StravaPhoto,
  athlete_id: number
): Photo | null {


  // Log the input photo data for debugging


  // Check if this appears to be a placeholder by looking for "placeholder" in the URL
  let isPlaceholder = false;

  if (photo.urls) {
    // Check all URLs for the word "placeholder"
    for (const url of Object.values(photo.urls)) {
      if (url.includes('placeholder')) {
        isPlaceholder = true;

        break;
      }
    }
  }

  // Fallback check - if it only has size 1800 (for backward compatibility)
  const urlKeys = photo.urls ? Object.keys(photo.urls) : [];
  if (!isPlaceholder && urlKeys.length === 1 && urlKeys[0] === "1800") {
    isPlaceholder = true;

  }

  // Skip placeholder images completely
  if (isPlaceholder) {

    return null;
  }

  // Process coordinates if they exist
  let location: number[] | null = null;

  if (photo.location) {
    // Validate location data
    if (Array.isArray(photo.location) && photo.location.length === 2 &&
      typeof photo.location[0] === 'number' && typeof photo.location[1] === 'number') {
      // Strava uses [lat, lng] format - convert to array for db schema
      location = [photo.location[0], photo.location[1]];

    } else {

    }
  }

  // Handle created_at timestamp conversion safely
  let createdAt: Date | null = null;
  if (photo.created_at) {
    // Check if created_at is a number (unix timestamp) or a string (ISO date)
    if (typeof photo.created_at === 'number') {
      createdAt = new Date(photo.created_at * 1000);
    } else if (typeof photo.created_at === 'string') {
      createdAt = new Date(photo.created_at);
    }
  }

  // Create the transformed photo object matching the database schema
  const transformedPhoto: Photo = {
    unique_id: photo.unique_id,
    athlete_id,
    activity_id: photo.activity_id,
    activity_name: photo.activity_name,
    caption: photo.caption,
    type: photo.type,
    source: photo.source,
    urls: photo.urls,
    sizes: photo.sizes,
    default_photo: photo.default_photo,
    location,
    uploaded_at: photo.uploaded_at ? new Date(photo.uploaded_at) : null,
    created_at: createdAt,
    post_id: photo.post_id,
    status: null,
    resource_state: photo.resource_state,
  };

  // Log the transformed photo for debugging
  // Get a sample URL for logging, if available
  let primaryUrlSample = 'none';
  if (photo.urls && urlKeys.length > 0) {
    const firstKey = urlKeys[0];
    if (firstKey && photo.urls[firstKey]) {
      const url = photo.urls[firstKey];
      if (typeof url === 'string') {
        primaryUrlSample = url.length > 30 ? `${url.substring(0, 30)}...` : url;
      }
    }
  }



  return transformedPhoto;
}
