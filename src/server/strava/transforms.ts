import { decode } from '@mapbox/polyline';
import type { Activity, Photo } from '~/server/db/schema';
import type { StravaActivity, StravaPhoto } from './types';

export function transformStravaActivity(
  activity: StravaActivity,
  isComplete: boolean = false,
): Omit<Activity, 'athlete'> {
  const start_date = new Date(activity.start_date);
  const local_date = new Date(
    start_date.toLocaleString('en-US', {
      timeZone: activity.timezone.split(' ').pop(),
    }),
  );

  let bbox: [number, number, number, number] = [0, 0, 0, 0];
  if (activity.map?.summary_polyline) {
    const coordinates = decode(activity.map.summary_polyline).map(
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
    ) as [number, number, number, number];
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

export function transformStravaPhoto(
  photo: StravaPhoto,
  athlete_id: number,
): Photo {
  // Convert location from [number, number] to number[] to match schema
  const location = photo.location ? Array.from(photo.location) : null;

  return {
    unique_id: photo.unique_id,
    athlete_id,
    activity_id: photo.activity_id,
    activity_name: photo.activity_name,
    resource_state: photo.resource_state,
    caption: photo.caption,
    type: photo.type,
    source: photo.source,
    status: null,
    post_id: photo.post_id,
    uploaded_at: photo.uploaded_at ? new Date(photo.uploaded_at) : null,
    created_at: photo.created_at ? new Date(photo.created_at) : null,
    urls: photo.urls,
    sizes: photo.sizes,
    default_photo: photo.default_photo,
    location,
  };
}
