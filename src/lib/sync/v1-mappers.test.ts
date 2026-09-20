import assert from 'node:assert/strict';
import test from 'node:test';

import type { Activity, Photo } from '~/server/db/schema.ts';
import { toActivityDTO } from '~/contracts/v1/activity.ts';
import { toPhotoDTO } from '~/contracts/v1/photo.ts';
import { dtoToActivity, dtoToPhoto } from './v1-mappers.ts';

const baseActivity: Activity = {
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

const basePhoto: Photo = {
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

const omitBridgedFields = (activity: Activity): Omit<Activity, 'public_id' | 'is_complete'> =>
  Object.fromEntries(
    Object.entries(activity).filter(([key]) => key !== 'public_id' && key !== 'is_complete'),
  ) as Omit<Activity, 'public_id' | 'is_complete'>;

void test('dtoToActivity round-trips every field toActivityDTO carries', () => {
  const dto = toActivityDTO(baseActivity);
  const restored = dtoToActivity(dto);

  assert.deepEqual(omitBridgedFields(restored), omitBridgedFields(baseActivity));

  // The two fields the v1 DTO has no equivalent for are documented bridge
  // values, not silently-dropped data — assert their documented behavior
  // explicitly rather than skipping them.
  assert.equal(restored.public_id, baseActivity.id, 'public_id bridges to the numeric activity id');
  assert.equal(restored.is_complete, true, 'is_complete bridges to geometry_state === "detailed"');
});

void test('dtoToActivity bridges is_complete to false for a summary-only activity', () => {
  const dto = toActivityDTO({ ...baseActivity, geometryState: null, is_complete: false });
  const restored = dtoToActivity(dto);
  assert.equal(dto.geometry_state, 'summary');
  assert.equal(restored.is_complete, false);
});

void test('dtoToPhoto round-trips every field exactly (PhotoDTO has no bridged fields)', () => {
  const dto = toPhotoDTO(basePhoto);
  const restored = dtoToPhoto(dto);
  assert.deepEqual(restored, basePhoto);
});

void test('dtoToActivity/dtoToPhoto decode string ids and ISO timestamps back to native types', () => {
  const dto = toActivityDTO(baseActivity);
  assert.equal(typeof dto.id, 'string');
  const restored = dtoToActivity(dto);
  assert.equal(typeof restored.id, 'number');
  assert.ok(restored.start_date instanceof Date);
  assert.equal(restored.start_date.getTime(), baseActivity.start_date.getTime());

  const photoDto = toPhotoDTO(basePhoto);
  assert.equal(typeof photoDto.activity_id, 'string');
  const restoredPhoto = dtoToPhoto(photoDto);
  assert.equal(typeof restoredPhoto.activity_id, 'number');
  assert.ok(restoredPhoto.created_at instanceof Date);
});
