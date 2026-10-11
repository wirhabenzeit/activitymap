import polyline from '@mapbox/polyline';
import { z } from 'zod';

import type { Activity } from '~/server/db/schema';
import type { ShareLinkFieldOptions } from '~/lib/sharing/fields';
import { SHARED_ROUTE_END_TRIM_METERS, trimRouteEnds } from '~/lib/sharing/route-trim';
import {
  COMPACT_SUMMARY_CODEC,
  MAX_SUMMARY_POINTS,
  encodeStreamSummary,
  unpackStreamSummary,
  type StoredStreamSummary,
} from '~/lib/streams/compact-summary';

/**
 * Elevation by distance, in the stream-summary codec
 * (`~/lib/streams/compact-summary.ts`) but restricted to the distance,
 * altitude and position series: time, heart rate and power are stripped.
 */
export const sharedElevationProfileSchema = z.object({
  codec: z.literal(COMPACT_SUMMARY_CODEC),
  algorithm_version: z.number().int().positive(),
  basis: z.literal('distance'),
  count: z.number().int().min(2).max(MAX_SUMMARY_POINTS),
  distance: z.string(),
  altitude: z.string(),
  latlng: z.string().optional(),
});

export type SharedElevationProfile = z.infer<typeof sharedElevationProfileSchema>;

/**
 * The wire shape of one track inside a private share link's recipient view
 * (issue #132). This is an **explicit allow-list**, not `ActivityDTO`
 * (`~/contracts/v1/activity.ts`) minus some excluded keys: a field has to be
 * added here deliberately before it can ever reach a recipient, so a future
 * field added to `Activity`/`ActivityDTO` is excluded by default instead of
 * silently exposed the next time this file is touched. See
 * docs/strava-data-policy.md §5.
 *
 * A share is track-level only: the route, its elevation profile and the
 * summary a GPS track implies. Heart rate, power, calories, kudos/comments/
 * achievements, other athletes, description, photos, gear, device metadata,
 * exact start/end coordinates, bounding box and the athlete's id are never
 * assembled here, whatever the share's options.
 */
export const sharedActivityDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  sport_type: z.string(),
  start_date_local: z.string(),
  distance: z.number().nullable(),
  moving_time: z.number().int().nullable(),
  total_elevation_gain: z.number().nullable(),
  average_speed: z.number().nullable(),
  /**
   * Encoded route, with both ends trimmed server-side unless the athlete
   * chose `showRouteEnds`. `null` when there is no route, or too little of it
   * would remain after trimming.
   */
  route_polyline: z.string().nullable(),
  /** Trimmed to the same visible stretch as `route_polyline`. */
  elevation_profile: sharedElevationProfileSchema.nullable(),
});

export type SharedActivityDTO = z.infer<typeof sharedActivityDTOSchema>;

function sharedRoutePolyline(
  summaryPolyline: string | null,
  fields: ShareLinkFieldOptions,
): string | null {
  if (!summaryPolyline) return null;
  if (fields.showRouteEnds) return summaryPolyline;
  const trimmed = trimRouteEnds(polyline.decode(summaryPolyline));
  return trimmed.length < 2 ? null : polyline.encode(trimmed);
}

function sharedElevationProfile(
  stored: StoredStreamSummary | null | undefined,
  fields: ShareLinkFieldOptions,
): SharedElevationProfile | null {
  if (!stored) return null;
  try {
    const summary = unpackStreamSummary(stored);
    const { distance, altitude, latlng } = summary;
    if (!distance || distance.length < 2 || altitude?.length !== distance.length) return null;
    if (!distance.every((value, index) => index === 0 || value >= distance[index - 1]!)) {
      return null;
    }
    const first = distance[0]!;
    const last = distance[distance.length - 1]!;
    if (!(last > first)) return null;

    let keep = distance.map((_, index) => index);
    if (!fields.showRouteEnds) {
      // Same rule as the route: nothing for short tracks, else drop both ends.
      if (last - first < SHARED_ROUTE_END_TRIM_METERS * 3) return null;
      keep = keep.filter(
        (index) =>
          distance[index]! >= first + SHARED_ROUTE_END_TRIM_METERS &&
          distance[index]! <= last - SHARED_ROUTE_END_TRIM_METERS,
      );
    }
    if (keep.length < 2) return null;

    const positions = latlng?.length === distance.length ? latlng : undefined;
    return sharedElevationProfileSchema.parse(
      encodeStreamSummary({
        version: summary.version,
        basis: 'distance',
        distance: keep.map((index) => distance[index]!),
        altitude: keep.map((index) => altitude[index]!),
        ...(positions ? { latlng: keep.map((index) => positions[index]!) } : {}),
      }),
    );
  } catch {
    return null;
  }
}

/**
 * Maps a Drizzle `Activity` row to the share-link recipient view. Validates
 * its own output against the allow-list schema above, so a call site that
 * accidentally spreads extra keys into the object literal is stripped here
 * instead of silently widening what a recipient sees.
 */
export function toSharedActivityDTO(
  activity: Activity,
  fields: ShareLinkFieldOptions,
  streamSummary?: StoredStreamSummary | null,
): SharedActivityDTO {
  return sharedActivityDTOSchema.parse({
    id: String(activity.id),
    name: activity.name,
    sport_type: activity.sport_type,
    start_date_local: activity.start_date_local.toISOString(),
    distance: activity.distance,
    moving_time: activity.moving_time,
    total_elevation_gain: activity.total_elevation_gain,
    average_speed: activity.average_speed,
    route_polyline: sharedRoutePolyline(activity.map_summary_polyline, fields),
    elevation_profile: sharedElevationProfile(streamSummary, fields),
  });
}
