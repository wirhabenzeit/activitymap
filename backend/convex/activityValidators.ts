import { v } from 'convex/values';

import { sportTypes } from '../../src/contracts/sport';

const nullableString = v.union(v.string(), v.null());
const nullableNumber = v.union(v.number(), v.null());
const place = v.object({
  id: v.string(),
  name: v.string(),
  kinds: v.array(
    v.union(v.literal('peak'), v.literal('pass'), v.literal('hut')),
  ),
  longitude: v.number(),
  latitude: v.number(),
  elevationM: nullableNumber,
  visits: v.array(v.object({ distanceM: nullableNumber })),
});

export const streamMetadataValidator = v.object({
  generation: nullableString,
  revision: v.string(),
  state: v.union(
    v.literal('not_fetched'),
    v.literal('current'),
    v.literal('stale'),
  ),
  fetch_status: v.union(
    v.literal('not_fetched'),
    v.literal('pending'),
    v.literal('succeeded'),
    v.literal('failed'),
    v.literal('invalidated'),
  ),
  available_types: v.array(
    v.union(
      v.literal('time'),
      v.literal('distance'),
      v.literal('latlng'),
      v.literal('altitude'),
      v.literal('watts'),
      v.literal('heartrate'),
    ),
  ),
  fetched_at: nullableString,
  expires_at: nullableString,
});

export const placeMatchValidator = v.object({
  userId: v.string(),
  activityId: v.string(),
  status: v.union(
    v.literal('complete'),
    v.literal('partial'),
    v.literal('uncovered'),
    v.literal('missing_streams'),
    v.literal('unavailable'),
    v.literal('pending'),
  ),
  streamGeneration: nullableString,
  streamRevision: v.string(),
  catalogueSnapshotId: nullableString,
  matcherVersion: v.string(),
  matchingVersion: v.optional(v.string()),
  resultRevision: v.optional(nullableString),
  places: v.array(place),
});

export const activityProjectionValidator = v.object({
  version: v.number(),
  generation: v.optional(v.string()),
  sourceVersion: v.optional(v.string()),
  streams: v.optional(streamMetadataValidator),
  match: v.optional(
    v.object({ catalogue: v.string(), value: placeMatchValidator }),
  ),
});

const nullableBoolean = v.union(v.boolean(), v.null());
const nullableNumbers = v.union(v.array(v.number()), v.null());
export const activityMetadataValidator = v.object({
  id: v.string(),
  athlete: v.string(),
  name: v.string(),
  description: nullableString,
  distance: nullableNumber,
  moving_time: nullableNumber,
  elapsed_time: nullableNumber,
  total_elevation_gain: nullableNumber,
  sport_type: v.union(...sportTypes.map((sport) => v.literal(sport))),
  start_date: v.string(),
  start_date_local: v.string(),
  timezone: v.string(),
  start_latlng: nullableNumbers,
  end_latlng: nullableNumbers,
  achievement_count: nullableNumber,
  kudos_count: nullableNumber,
  comment_count: nullableNumber,
  athlete_count: nullableNumber,
  photo_count: nullableNumber,
  total_photo_count: nullableNumber,
  map_id: nullableString,
  map_polyline: nullableString,
  map_summary_polyline: nullableString,
  map_bbox: nullableNumbers,
  trainer: nullableBoolean,
  commute: nullableBoolean,
  manual: nullableBoolean,
  private: nullableBoolean,
  flagged: nullableBoolean,
  workout_type: nullableNumber,
  upload_id: nullableString,
  average_speed: nullableNumber,
  max_speed: nullableNumber,
  calories: nullableNumber,
  has_heartrate: nullableBoolean,
  average_heartrate: nullableNumber,
  max_heartrate: nullableNumber,
  heartrate_opt_out: nullableBoolean,
  display_hide_heartrate_option: nullableBoolean,
  elev_high: nullableNumber,
  elev_low: nullableNumber,
  pr_count: nullableNumber,
  has_kudoed: nullableBoolean,
  hide_from_home: nullableBoolean,
  gear_id: nullableString,
  device_watts: nullableBoolean,
  average_watts: nullableNumber,
  max_watts: nullableNumber,
  weighted_average_watts: nullableNumber,
  kilojoules: nullableNumber,
  last_updated: nullableString,
  geometry_state: v.union(
    v.literal('summary'),
    v.literal('detailed'),
    v.literal('refresh_required'),
  ),
  photos_state: v.union(
    v.literal('current'),
    v.literal('refresh_required'),
    v.null(),
  ),
  last_summary_seen_at: nullableString,
  last_detailed_fetched_at: nullableString,
});
