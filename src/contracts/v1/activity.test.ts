import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toActivityDTO, activityDTOSchema } from './activity.ts';
import type { Activity } from '~/server/db/schema';

const fixtureActivity: Activity = {
  id: 12345678901234, // a realistically large activity id, encoded as a string on the wire
  public_id: 42,
  athlete: 123456789,
  name: 'Morning Run',
  description: null,
  distance: 5000,
  moving_time: 1800,
  elapsed_time: 1900,
  total_elevation_gain: 50,
  sport_type: 'Run',
  start_date: new Date('2024-01-31T08:00:00.000Z'),
  start_date_local: new Date('2024-01-31T09:00:00.000Z'),
  timezone: '(GMT+01:00) Europe/Zurich',
  start_latlng: [47.1, 8.5],
  end_latlng: [47.2, 8.6],
  achievement_count: 0,
  kudos_count: 0,
  comment_count: 0,
  athlete_count: 1,
  photo_count: 0,
  total_photo_count: 0,
  map_id: null,
  map_polyline: null,
  map_summary_polyline: null,
  map_bbox: null,
  trainer: false,
  commute: false,
  manual: false,
  private: false,
  flagged: false,
  workout_type: null,
  upload_id: null,
  average_speed: 2.78,
  max_speed: 3.5,
  calories: 300,
  has_heartrate: false,
  average_heartrate: null,
  max_heartrate: null,
  heartrate_opt_out: false,
  display_hide_heartrate_option: false,
  elev_high: null,
  elev_low: null,
  pr_count: 0,
  has_kudoed: false,
  hide_from_home: false,
  gear_id: null,
  device_watts: false,
  average_watts: null,
  max_watts: null,
  weighted_average_watts: null,
  kilojoules: null,
  last_updated: new Date('2024-01-31T10:00:00.000Z'),
  geometryState: null,
  photosState: null,
  lastSummarySeenAt: null,
  lastDetailedFetchedAt: null,
  is_complete: true,
};

void test('toActivityDTO encodes large ids as strings and dates as ISO 8601', () => {
  const dto = toActivityDTO(fixtureActivity);
  assert.equal(dto.id, '12345678901234');
  assert.equal(dto.athlete, '123456789');
  assert.equal(dto.start_date, '2024-01-31T08:00:00.000Z');
  assert.equal(dto.last_updated, '2024-01-31T10:00:00.000Z');
  assert.equal(typeof dto.id, 'string');
});

void test('toActivityDTO excludes the legacy public_id capability token', () => {
  const dto = toActivityDTO(fixtureActivity);
  assert.equal('public_id' in dto, false);
});

void test('toActivityDTO never leaks a null last_updated as anything but null', () => {
  const dto = toActivityDTO({ ...fixtureActivity, last_updated: null });
  assert.equal(dto.last_updated, null);
});

void test('toActivityDTO excludes the raw is_complete field', () => {
  const dto = toActivityDTO(fixtureActivity);
  assert.equal('is_complete' in dto, false);
});

void test('toActivityDTO derives geometry_state "detailed" from is_complete: true', () => {
  const dto = toActivityDTO({ ...fixtureActivity, is_complete: true });
  assert.equal(dto.geometry_state, 'detailed');
});

void test('toActivityDTO derives geometry_state "summary" from is_complete: false', () => {
  const dto = toActivityDTO({ ...fixtureActivity, is_complete: false });
  assert.equal(dto.geometry_state, 'summary');
});

void test('toActivityDTO serializes real component freshness when present', () => {
  const dto = toActivityDTO({
    ...fixtureActivity,
    geometryState: 'refresh_required',
    photosState: 'current',
    lastSummarySeenAt: new Date('2024-02-01T10:00:00.000Z'),
    lastDetailedFetchedAt: new Date('2024-01-31T10:00:00.000Z'),
  });
  assert.equal(dto.geometry_state, 'refresh_required');
  assert.equal(dto.photos_state, 'current');
  assert.equal(dto.last_summary_seen_at, '2024-02-01T10:00:00.000Z');
  assert.equal(dto.last_detailed_fetched_at, '2024-01-31T10:00:00.000Z');
});

void test('activityDTOSchema rejects a raw Drizzle row (numeric id) passed through unmapped', () => {
  const result = activityDTOSchema.safeParse({
    ...fixtureActivity,
    start_date: fixtureActivity.start_date.toISOString(),
    start_date_local: fixtureActivity.start_date_local.toISOString(),
    last_updated: fixtureActivity.last_updated?.toISOString() ?? null,
  });
  assert.equal(result.success, false);
});

void test('activityDTOSchema accepts the mapped DTO shape', () => {
  const dto = toActivityDTO(fixtureActivity);
  const result = activityDTOSchema.safeParse(dto);
  assert.equal(result.success, true);
});
