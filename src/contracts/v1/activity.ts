import { streamMetadataSchema, type StreamMetadata } from './activity-streams';
import { z } from 'zod';
import type { Activity } from '~/server/db/schema';
import { sportTypes } from '~/server/db/schema';
import { idString, isoDateTime, toIdString, toIsoDateTime } from './primitives';

/**
 * The v1 wire shape of an activity. Every potentially-large numeric id is a
 * string and every timestamp is a UTC ISO 8601 string — this is never the
 * Drizzle `Activity` row itself (see issue #119/#116). Field names are kept
 * snake_case to match the existing web client and Strava's own vocabulary;
 * only the transport encoding (ids, dates) changes.
 *
 * `public_id` is deliberately excluded: it is a deterministic, guessable
 * capability token for the legacy sharing feature that issue #132 plans to
 * retire in favor of a random, revocable, hashed token, and has no other
 * use as a general activity attribute for a native client.
 *
 * The raw `is_complete` boolean is deliberately excluded too. Per
 * `docs/swiftui-backend-preparation-plan.md` ("Strava retention rules
 * affect the offline design") and `docs/strava-data-policy.md` ("Cache
 * freshness through summary reconciliation"), the monolithic completeness
 * flag is being replaced by component-level freshness during the sync
 * migration (issue #122): `geometryState`, `photosState`,
 * `lastSummarySeenAt`, and `lastDetailedFetchedAt`. This DTO commits to that
 * target shape now so the wire contract (and any generated Swift client) is
 * forward-compatible. Production reconciliation has populated the component
 * state for every activity, so the DTO no longer infers freshness from the
 * legacy flag.
 */
export const geometryStateSchema = z.enum(['summary', 'detailed', 'refresh_required']);
export type GeometryState = z.infer<typeof geometryStateSchema>;

export const photosStateSchema = z.enum(['current', 'refresh_required']);
export type PhotosState = z.infer<typeof photosStateSchema>;

export const activityDTOSchema = z.object({
  streams: streamMetadataSchema.optional(),
  id: idString,
  athlete: idString,
  name: z.string(),
  description: z.string().nullable(),
  distance: z.number().nullable(),
  moving_time: z.number().int().nullable(),
  elapsed_time: z.number().int().nullable(),
  total_elevation_gain: z.number().nullable(),
  sport_type: z.enum(sportTypes),
  start_date: isoDateTime,
  start_date_local: isoDateTime,
  timezone: z.string(),
  start_latlng: z.array(z.number()).nullable(),
  end_latlng: z.array(z.number()).nullable(),
  achievement_count: z.number().int().nullable(),
  kudos_count: z.number().int().nullable(),
  comment_count: z.number().int().nullable(),
  athlete_count: z.number().int().nullable(),
  photo_count: z.number().int().nullable(),
  total_photo_count: z.number().int().nullable(),
  map_id: z.string().nullable(),
  map_polyline: z.string().nullable(),
  map_summary_polyline: z.string().nullable(),
  map_bbox: z.array(z.number()).nullable(),
  trainer: z.boolean().nullable(),
  commute: z.boolean().nullable(),
  manual: z.boolean().nullable(),
  private: z.boolean().nullable(),
  flagged: z.boolean().nullable(),
  workout_type: z.number().int().nullable(),
  upload_id: idString.nullable(),
  average_speed: z.number().nullable(),
  max_speed: z.number().nullable(),
  calories: z.number().nullable(),
  has_heartrate: z.boolean().nullable(),
  average_heartrate: z.number().nullable(),
  max_heartrate: z.number().nullable(),
  heartrate_opt_out: z.boolean().nullable(),
  display_hide_heartrate_option: z.boolean().nullable(),
  elev_high: z.number().nullable(),
  elev_low: z.number().nullable(),
  pr_count: z.number().int().nullable(),
  has_kudoed: z.boolean().nullable(),
  hide_from_home: z.boolean().nullable(),
  gear_id: z.string().nullable(),
  device_watts: z.boolean().nullable(),
  average_watts: z.number().nullable(),
  max_watts: z.number().int().nullable(),
  weighted_average_watts: z.number().int().nullable(),
  kilojoules: z.number().nullable(),
  last_updated: isoDateTime.nullable(),
  geometry_state: geometryStateSchema,
  photos_state: photosStateSchema.nullable(),
  last_summary_seen_at: isoDateTime.nullable(),
  last_detailed_fetched_at: isoDateTime.nullable(),
});

export type ActivityDTO = z.infer<typeof activityDTOSchema>;

/** Maps a Drizzle `Activity` row to the v1 wire contract. Validates its own
 * output, so a future schema.ts change that breaks the contract fails loud
 * here instead of silently changing the wire shape. */
export function toActivityDTO(activity: Activity & { streamsMetadata?: StreamMetadata }): ActivityDTO {
  return activityDTOSchema.parse({
    ...(activity.streamsMetadata ? { streams: activity.streamsMetadata } : {}),
    id: toIdString(activity.id),
    athlete: toIdString(activity.athlete),
    name: activity.name,
    description: activity.description,
    distance: activity.distance,
    moving_time: activity.moving_time,
    elapsed_time: activity.elapsed_time,
    total_elevation_gain: activity.total_elevation_gain,
    sport_type: activity.sport_type,
    start_date: toIsoDateTime(activity.start_date),
    start_date_local: toIsoDateTime(activity.start_date_local),
    timezone: activity.timezone,
    start_latlng: activity.start_latlng,
    end_latlng: activity.end_latlng,
    achievement_count: activity.achievement_count,
    kudos_count: activity.kudos_count,
    comment_count: activity.comment_count,
    athlete_count: activity.athlete_count,
    photo_count: activity.photo_count,
    total_photo_count: activity.total_photo_count,
    map_id: activity.map_id,
    map_polyline: activity.map_polyline,
    map_summary_polyline: activity.map_summary_polyline,
    map_bbox: activity.map_bbox,
    trainer: activity.trainer,
    commute: activity.commute,
    manual: activity.manual,
    private: activity.private,
    flagged: activity.flagged,
    workout_type: activity.workout_type,
    upload_id: activity.upload_id === null ? null : toIdString(activity.upload_id),
    average_speed: activity.average_speed,
    max_speed: activity.max_speed,
    calories: activity.calories,
    has_heartrate: activity.has_heartrate,
    average_heartrate: activity.average_heartrate,
    max_heartrate: activity.max_heartrate,
    heartrate_opt_out: activity.heartrate_opt_out,
    display_hide_heartrate_option: activity.display_hide_heartrate_option,
    elev_high: activity.elev_high,
    elev_low: activity.elev_low,
    pr_count: activity.pr_count,
    has_kudoed: activity.has_kudoed,
    hide_from_home: activity.hide_from_home,
    gear_id: activity.gear_id,
    device_watts: activity.device_watts,
    average_watts: activity.average_watts,
    max_watts: activity.max_watts,
    weighted_average_watts: activity.weighted_average_watts,
    kilojoules: activity.kilojoules,
    last_updated: activity.last_updated ? toIsoDateTime(activity.last_updated) : null,
    geometry_state: activity.geometryState,
    photos_state: activity.photosState,
    last_summary_seen_at: activity.lastSummarySeenAt
      ? toIsoDateTime(activity.lastSummarySeenAt)
      : null,
    last_detailed_fetched_at: activity.lastDetailedFetchedAt
      ? toIsoDateTime(activity.lastDetailedFetchedAt)
      : null,
  });
}
