import assert from 'node:assert/strict';
import test from 'node:test';

import type { Activity, Photo } from '~/server/db/schema.ts';
import {
  toActivity,
  toPhoto,
  type SerializedActivity,
  type SerializedPhoto,
} from '~/lib/offline/sync.ts';
import { toActivityDTO } from '~/contracts/v1/activity.ts';
import { toPhotoDTO } from '~/contracts/v1/photo.ts';
import { dtoToActivity, dtoToPhoto } from './v1-mappers.ts';

/**
 * Issue #126 phase 2's parity check: given the same underlying `Activity`/
 * `Photo` row, does applying the legacy `/api/offline/*` client path
 * (`~/lib/offline/sync.ts`'s real `toActivity`/`toPhoto`, fed the exact JSON
 * the legacy route would have produced - `NextResponse.json` on the raw
 * Drizzle row) land on the same local-store state as applying the new v1
 * path (the real `toActivityDTO`/`toPhotoDTO` + `dtoToActivity`/
 * `dtoToPhoto`)? This is the "seed both old and new sync responses from the
 * same fixture and diff the resulting local store state" style from
 * `~/server/sync/sqlite-client-proof.test.ts`, applied to the client-side
 * mapping layer rather than a database.
 *
 * Both paths are real production code, not reimplementations - only the
 * HTTP transport itself is skipped, exactly as in
 * `~/lib/sync/v1-client.test.ts`.
 */

const activity: Activity = {
  id: 7,
  public_id: 49,
  athlete: 42,
  name: 'Morning Run',
  description: 'nice pace',
  distance: 5000,
  moving_time: 1800,
  elapsed_time: 1900,
  total_elevation_gain: 50,
  sport_type: 'Run',
  start_date: new Date('2026-01-01T06:00:00.000Z'),
  start_date_local: new Date('2026-01-01T07:00:00.000Z'),
  timezone: 'Europe/Berlin',
  start_latlng: [52.5, 13.4],
  end_latlng: [52.6, 13.5],
  achievement_count: 1,
  kudos_count: 2,
  comment_count: 0,
  athlete_count: 1,
  photo_count: 3,
  total_photo_count: 3,
  map_id: 'map1',
  map_polyline: 'poly',
  map_summary_polyline: 'summary-poly',
  map_bbox: [1, 2, 3, 4],
  trainer: false,
  commute: false,
  manual: false,
  private: false,
  flagged: false,
  workout_type: 0,
  upload_id: 12345,
  average_speed: 2.7,
  max_speed: 3.5,
  calories: 300,
  has_heartrate: true,
  average_heartrate: 150,
  max_heartrate: 180,
  heartrate_opt_out: false,
  display_hide_heartrate_option: false,
  elev_high: 100,
  elev_low: 10,
  pr_count: 0,
  has_kudoed: false,
  hide_from_home: false,
  gear_id: 'g1',
  device_watts: false,
  average_watts: 150,
  max_watts: 300,
  weighted_average_watts: 160,
  kilojoules: 500,
  last_updated: new Date('2026-01-02T00:00:00.000Z'),
  geometryState: 'detailed',
  photosState: 'current',
  lastSummarySeenAt: new Date('2026-01-01T08:00:00.000Z'),
  lastDetailedFetchedAt: new Date('2026-01-01T09:00:00.000Z'),
  is_complete: true,
};

const photo: Photo = {
  unique_id: 'photo-1',
  activity_id: 7,
  athlete_id: 42,
  activity_name: 'Morning Run',
  caption: 'nice view',
  type: 0,
  source: 1,
  urls: { '100': 'https://example.test/100.jpg' },
  sizes: { '100': [100, 100] },
  default_photo: true,
  location: [52.5, 13.4],
  uploaded_at: new Date('2026-01-01T06:30:00.000Z'),
  created_at: new Date('2026-01-01T06:31:00.000Z'),
  post_id: 1,
  status: 'ready',
  resource_state: 3,
};

/** What `/api/offline/bootstrap` actually sends: `NextResponse.json(payload)` on the raw Drizzle row - a plain JSON round trip. */
function activityOverTheWireJson(value: Activity): SerializedActivity {
  return JSON.parse(JSON.stringify(value)) as SerializedActivity;
}

/** See `activityOverTheWireJson`. */
function photoOverTheWireJson(value: Photo): SerializedPhoto {
  return JSON.parse(JSON.stringify(value)) as SerializedPhoto;
}

/**
 * Every `Activity` field both paths agree on. Excludes:
 *  - `public_id`/`is_complete`: the two v1-DTO-bridged fields (see
 *    `v1-mappers.ts`'s doc comment) - already covered by their own
 *    assertions below, not by this blanket comparison.
 *  - `lastSummarySeenAt`/`lastDetailedFetchedAt`: this test *found* that the
 *    legacy path never converts these two (newer, #123-era) columns back to
 *    `Date` on the client - `~/lib/offline/sync.ts`'s `SerializedActivity`/
 *    `toActivity` only ever knew about `start_date`/`start_date_local`/
 *    `last_updated`. This is a real, pre-existing latent bug in the legacy
 *    path (a `string` where the `Activity` type promises a `Date`), not
 *    something this migration should reproduce - the v1 path's
 *    `dtoToActivity` gets this right. It has never mattered in practice
 *    because no UI code reads either field (see `v1-mappers.ts`'s doc
 *    comment); asserted explicitly below rather than silently excluded.
 */
const UI_OBSERVABLE_ACTIVITY_FIELDS = Object.keys(activity).filter(
  (key) =>
    key !== 'public_id' &&
    key !== 'is_complete' &&
    key !== 'lastSummarySeenAt' &&
    key !== 'lastDetailedFetchedAt',
) as (keyof Activity)[];

function pick<T extends object, K extends keyof T>(value: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) result[key] = value[key];
  return result;
}

void test('legacy /api/offline/* path and the new v1 sync path land on the same local-store Activity for every UI-observable field', () => {
  const legacyResult = toActivity(activityOverTheWireJson(activity));
  const v1Result = dtoToActivity(toActivityDTO(activity));

  assert.deepEqual(
    pick(legacyResult, UI_OBSERVABLE_ACTIVITY_FIELDS),
    pick(v1Result, UI_OBSERVABLE_ACTIVITY_FIELDS),
  );
  assert.deepEqual(pick(legacyResult, UI_OBSERVABLE_ACTIVITY_FIELDS), pick(activity, UI_OBSERVABLE_ACTIVITY_FIELDS));

  // The documented legacy quirk above, made explicit rather than just
  // excluded from the comparison.
  assert.equal(
    typeof legacyResult.lastSummarySeenAt,
    'string',
    'legacy path leaves lastSummarySeenAt as a raw ISO string, not a Date - a pre-existing bug, unread by any UI code',
  );
  assert.ok(v1Result.lastSummarySeenAt instanceof Date, 'v1 path correctly restores a Date');
});

void test('legacy and v1 paths land on an identical local-store Photo (no bridged fields at all)', () => {
  const legacyResult = toPhoto(photoOverTheWireJson(photo));
  const v1Result = dtoToPhoto(toPhotoDTO(photo));

  assert.deepEqual(legacyResult, v1Result);
  assert.deepEqual(legacyResult, photo);
});

void test('a null last_updated/photo timestamp round-trips identically through both paths', () => {
  const activityWithNulls: Activity = { ...activity, last_updated: null };
  const photoWithNulls: Photo = { ...photo, uploaded_at: null, created_at: null };

  const legacyActivity = toActivity(activityOverTheWireJson(activityWithNulls));
  const v1Activity = dtoToActivity(toActivityDTO(activityWithNulls));
  assert.equal(legacyActivity.last_updated, null);
  assert.equal(v1Activity.last_updated, null);

  const legacyPhoto = toPhoto(photoOverTheWireJson(photoWithNulls));
  const v1Photo = dtoToPhoto(toPhotoDTO(photoWithNulls));
  assert.deepEqual(legacyPhoto, v1Photo);
});
