/**
 * Maps v1 sync DTOs (`~/contracts/v1/activity.ts`/`photo.ts` — decimal-string
 * ids, ISO-string timestamps) to the in-memory `Activity`/`Photo` shape the
 * rest of the web app already renders (`~/server/db/schema`'s Drizzle
 * `$inferSelect` types — numeric ids, `Date` fields).
 *
 * This is the one place in the client-side sync path that is allowed to
 * know about both shapes. It exists so the sync/persistence *transport*
 * (issue #126's scope) can move fully onto the v1 contract without also
 * forcing every list/map/chart component in the app to be rewritten around
 * string ids in the same change — those components keep consuming
 * `Activity`/`Photo` exactly as before; only where that value comes from
 * changes.
 *
 * Two `Activity` fields have no v1 DTO equivalent, by design:
 *  - `public_id`: the v1 DTO deliberately excludes it (see
 *    `~/contracts/v1/activity.ts`'s doc comment — it is the legacy sharing
 *    capability token issue #132 is retiring). Legacy sharing is disabled
 *    (`~/lib/legacy-sharing.ts`'s `LEGACY_SHARING_ENABLED`), so nothing
 *    reads this field for a sync-sourced activity; we fill it with the
 *    numeric activity id, which is unique and stable but must not be
 *    treated as a real public id if legacy sharing is ever re-enabled.
 *  - `is_complete`: superseded by `geometry_state`/`photos_state` (see the
 *    same doc comment). No app code outside the v1 DTO mapper reads
 *    `is_complete` (verified by grep across `src/components`, `src/hooks`,
 *    `src/store`, `src/lib`), so an approximate bridge value — "has this
 *    activity's detailed geometry been fetched" — is good enough here.
 */

import type { Activity, Photo } from '~/server/db/schema';
import type { ActivityDTO } from '~/contracts/v1/activity';
import type { PhotoDTO } from '~/contracts/v1/photo';

const toDate = (iso: string): Date => new Date(iso);
const toNullableDate = (iso: string | null): Date | null => (iso === null ? null : new Date(iso));

export function dtoToActivity(dto: ActivityDTO): Activity {
  return {
    id: Number(dto.id),
    public_id: Number(dto.id),
    athlete: Number(dto.athlete),
    name: dto.name,
    description: dto.description,
    distance: dto.distance,
    moving_time: dto.moving_time,
    elapsed_time: dto.elapsed_time,
    total_elevation_gain: dto.total_elevation_gain,
    sport_type: dto.sport_type,
    start_date: toDate(dto.start_date),
    start_date_local: toDate(dto.start_date_local),
    timezone: dto.timezone,
    start_latlng: dto.start_latlng,
    end_latlng: dto.end_latlng,
    achievement_count: dto.achievement_count,
    kudos_count: dto.kudos_count,
    comment_count: dto.comment_count,
    athlete_count: dto.athlete_count,
    photo_count: dto.photo_count,
    total_photo_count: dto.total_photo_count,
    map_id: dto.map_id,
    map_polyline: dto.map_polyline,
    map_summary_polyline: dto.map_summary_polyline,
    map_bbox: dto.map_bbox,
    trainer: dto.trainer,
    commute: dto.commute,
    manual: dto.manual,
    private: dto.private,
    flagged: dto.flagged,
    workout_type: dto.workout_type,
    upload_id: dto.upload_id === null ? null : Number(dto.upload_id),
    average_speed: dto.average_speed,
    max_speed: dto.max_speed,
    calories: dto.calories,
    has_heartrate: dto.has_heartrate,
    average_heartrate: dto.average_heartrate,
    max_heartrate: dto.max_heartrate,
    heartrate_opt_out: dto.heartrate_opt_out,
    display_hide_heartrate_option: dto.display_hide_heartrate_option,
    elev_high: dto.elev_high,
    elev_low: dto.elev_low,
    pr_count: dto.pr_count,
    has_kudoed: dto.has_kudoed,
    hide_from_home: dto.hide_from_home,
    gear_id: dto.gear_id,
    device_watts: dto.device_watts,
    average_watts: dto.average_watts,
    max_watts: dto.max_watts,
    weighted_average_watts: dto.weighted_average_watts,
    kilojoules: dto.kilojoules,
    last_updated: toNullableDate(dto.last_updated),
    geometryState: dto.geometry_state,
    photosState: dto.photos_state,
    lastSummarySeenAt: toNullableDate(dto.last_summary_seen_at),
    lastDetailedFetchedAt: toNullableDate(dto.last_detailed_fetched_at),
    is_complete: dto.geometry_state === 'detailed',
  };
}

export function dtoToPhoto(dto: PhotoDTO): Photo {
  return {
    unique_id: dto.unique_id,
    activity_id: Number(dto.activity_id),
    athlete_id: Number(dto.athlete_id),
    activity_name: dto.activity_name,
    caption: dto.caption,
    type: dto.type,
    source: dto.source,
    urls: dto.urls,
    sizes: dto.sizes,
    default_photo: dto.default_photo,
    location: dto.location,
    uploaded_at: toNullableDate(dto.uploaded_at),
    created_at: toNullableDate(dto.created_at),
    post_id: dto.post_id,
    status: dto.status,
    resource_state: dto.resource_state,
  };
}
