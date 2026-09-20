import { z } from 'zod';

import type { Activity } from '~/server/db/schema';
import type { ShareLinkFieldOptions } from '~/lib/sharing/fields';

/**
 * The wire shape of one activity inside a private share link's recipient
 * view (issue #132). This is an **explicit allow-list**, not `ActivityDTO`
 * (`~/contracts/v1/activity.ts`) minus some excluded keys: a field has to be
 * added here deliberately before it can ever reach a recipient, so a future
 * field added to `Activity`/`ActivityDTO` is excluded by default instead of
 * silently exposed the next time this file is touched. See
 * docs/strava-data-policy.md §5.
 *
 * Fields never exposed by this DTO at all, regardless of the share's chosen
 * `ShareLinkFieldOptions` - not "excluded by default", but simply never
 * assembled anywhere below: `description` (free text the athlete wrote,
 * which can contain anything), photos, gear, device/upload metadata,
 * internal freshness/sync bookkeeping, and the athlete's own id. The four
 * groups below are the *only* fields ever gated by opt-in rather than always
 * omitted or always included.
 */
export const sharedActivityDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  sport_type: z.string(),
  start_date: z.string(),
  start_date_local: z.string(),
  timezone: z.string(),
  distance: z.number().nullable(),
  moving_time: z.number().int().nullable(),
  elapsed_time: z.number().int().nullable(),
  total_elevation_gain: z.number().nullable(),
  average_speed: z.number().nullable(),
  max_speed: z.number().nullable(),
  elev_high: z.number().nullable(),
  elev_low: z.number().nullable(),
  map_summary_polyline: z.string().nullable(),
  map_bbox: z.array(z.number()).nullable(),
  trainer: z.boolean().nullable(),
  commute: z.boolean().nullable(),
  manual: z.boolean().nullable(),

  // Opt-in groups - present only when the creating athlete's
  // `ShareLinkFieldOptions` enabled them. See `~/lib/sharing/fields.ts`.
  has_heartrate: z.boolean().nullable().optional(),
  average_heartrate: z.number().nullable().optional(),
  max_heartrate: z.number().nullable().optional(),

  device_watts: z.boolean().nullable().optional(),
  average_watts: z.number().nullable().optional(),
  max_watts: z.number().int().nullable().optional(),
  weighted_average_watts: z.number().int().nullable().optional(),
  kilojoules: z.number().nullable().optional(),
  calories: z.number().nullable().optional(),

  kudos_count: z.number().int().nullable().optional(),
  comment_count: z.number().int().nullable().optional(),
  achievement_count: z.number().int().nullable().optional(),
  athlete_count: z.number().int().nullable().optional(),
  pr_count: z.number().int().nullable().optional(),
  has_kudoed: z.boolean().nullable().optional(),

  start_latlng: z.array(z.number()).nullable().optional(),
  end_latlng: z.array(z.number()).nullable().optional(),
});

export type SharedActivityDTO = z.infer<typeof sharedActivityDTOSchema>;

/**
 * Maps a Drizzle `Activity` row to the share-link recipient view, gated by
 * `fields`. Validates its own output against the allow-list schema above, so
 * a call site that accidentally spreads extra keys into the object literal
 * would fail loudly here instead of silently widening what a recipient sees.
 */
export function toSharedActivityDTO(
  activity: Activity,
  fields: ShareLinkFieldOptions,
): SharedActivityDTO {
  const base = {
    id: String(activity.id),
    name: activity.name,
    sport_type: activity.sport_type,
    start_date: activity.start_date.toISOString(),
    start_date_local: activity.start_date_local.toISOString(),
    timezone: activity.timezone,
    distance: activity.distance,
    moving_time: activity.moving_time,
    elapsed_time: activity.elapsed_time,
    total_elevation_gain: activity.total_elevation_gain,
    average_speed: activity.average_speed,
    max_speed: activity.max_speed,
    elev_high: activity.elev_high,
    elev_low: activity.elev_low,
    map_summary_polyline: activity.map_summary_polyline,
    map_bbox: activity.map_bbox,
    trainer: activity.trainer,
    commute: activity.commute,
    manual: activity.manual,
  };

  const optional: Record<string, unknown> = {};

  if (fields.heartRate) {
    optional.has_heartrate = activity.has_heartrate;
    optional.average_heartrate = activity.average_heartrate;
    optional.max_heartrate = activity.max_heartrate;
  }
  if (fields.power) {
    optional.device_watts = activity.device_watts;
    optional.average_watts = activity.average_watts;
    optional.max_watts = activity.max_watts;
    optional.weighted_average_watts = activity.weighted_average_watts;
    optional.kilojoules = activity.kilojoules;
    optional.calories = activity.calories;
  }
  if (fields.social) {
    optional.kudos_count = activity.kudos_count;
    optional.comment_count = activity.comment_count;
    optional.achievement_count = activity.achievement_count;
    optional.athlete_count = activity.athlete_count;
    optional.pr_count = activity.pr_count;
    optional.has_kudoed = activity.has_kudoed;
  }
  if (fields.preciseLocation) {
    optional.start_latlng = activity.start_latlng;
    optional.end_latlng = activity.end_latlng;
  }

  return sharedActivityDTOSchema.parse({ ...base, ...optional });
}
