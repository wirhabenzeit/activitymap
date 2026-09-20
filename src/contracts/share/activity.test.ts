import assert from 'node:assert/strict';
import test from 'node:test';

import type { Activity } from '~/server/db/schema';
import { DEFAULT_SHARE_LINK_FIELD_OPTIONS } from '~/lib/sharing/fields';

import { sharedActivityDTOSchema, toSharedActivityDTO } from './activity.ts';

function buildActivity(overrides: Partial<Activity> & { id: number; athlete: number }): Activity {
  return {
    public_id: overrides.id * 7,
    name: `Activity ${overrides.id}`,
    description: 'A private note about where I ran, near my house',
    distance: 5000,
    moving_time: 1800,
    elapsed_time: 1900,
    total_elevation_gain: 42,
    sport_type: 'Run',
    start_date: new Date('2026-01-01T08:00:00.000Z'),
    start_date_local: new Date('2026-01-01T09:00:00.000Z'),
    timezone: 'Europe/Zurich',
    start_latlng: [47.1, 8.5],
    end_latlng: [47.2, 8.6],
    achievement_count: 3,
    kudos_count: 12,
    comment_count: 4,
    athlete_count: 2,
    photo_count: 1,
    total_photo_count: 1,
    map_id: 'map123',
    map_polyline: 'raw-polyline',
    map_summary_polyline: 'summary-polyline',
    map_bbox: [8.4, 47.0, 8.7, 47.3],
    trainer: false,
    commute: false,
    manual: false,
    private: false,
    flagged: false,
    workout_type: 0,
    upload_id: 999,
    average_speed: 2.7,
    max_speed: 4.1,
    calories: 350,
    has_heartrate: true,
    average_heartrate: 150,
    max_heartrate: 180,
    heartrate_opt_out: false,
    display_hide_heartrate_option: false,
    elev_high: 500,
    elev_low: 400,
    pr_count: 1,
    has_kudoed: false,
    hide_from_home: false,
    gear_id: 'g1',
    device_watts: true,
    average_watts: 200,
    max_watts: 350,
    weighted_average_watts: 210,
    kilojoules: 900,
    last_updated: new Date('2026-01-01T10:00:00.000Z'),
    geometryState: 'detailed',
    photosState: 'current',
    lastSummarySeenAt: null,
    lastDetailedFetchedAt: null,
    is_complete: true,
    ...overrides,
  };
}

const ACTIVITY = buildActivity({ id: 42, athlete: 1001 });

void test('excludes health data, social fields, and precise location by default', () => {
  const dto = toSharedActivityDTO(ACTIVITY, DEFAULT_SHARE_LINK_FIELD_OPTIONS);

  for (const key of [
    'has_heartrate',
    'average_heartrate',
    'max_heartrate',
    'device_watts',
    'average_watts',
    'max_watts',
    'weighted_average_watts',
    'kilojoules',
    'calories',
    'kudos_count',
    'comment_count',
    'achievement_count',
    'athlete_count',
    'pr_count',
    'has_kudoed',
    'start_latlng',
    'end_latlng',
  ] as const) {
    assert.equal(
      key in dto,
      false,
      `expected "${key}" to be absent from the default share view`,
    );
  }
});

void test('never exposes fields outside the allow-list, regardless of options', () => {
  const dto = toSharedActivityDTO(ACTIVITY, {
    heartRate: true,
    power: true,
    social: true,
    preciseLocation: true,
  }) as Record<string, unknown>;

  for (const key of [
    'description',
    'photo_count',
    'total_photo_count',
    'gear_id',
    'upload_id',
    'hide_from_home',
    'heartrate_opt_out',
    'display_hide_heartrate_option',
    'flagged',
    'private',
    'last_updated',
    'map_polyline',
    'map_id',
  ] as const) {
    assert.equal(
      key in dto,
      false,
      `expected "${key}" to never be exposed by the allow-list DTO`,
    );
  }
});

void test('always includes the safe baseline fields', () => {
  const dto = toSharedActivityDTO(ACTIVITY, DEFAULT_SHARE_LINK_FIELD_OPTIONS);

  assert.equal(dto.id, '42');
  assert.equal(dto.name, 'Activity 42');
  assert.equal(dto.sport_type, 'Run');
  assert.equal(dto.distance, 5000);
  assert.equal(dto.map_summary_polyline, 'summary-polyline');
});

void test('each opt-in group is only revealed when its flag is explicitly true', () => {
  const heartRateOnly = toSharedActivityDTO(ACTIVITY, {
    ...DEFAULT_SHARE_LINK_FIELD_OPTIONS,
    heartRate: true,
  });
  assert.equal(heartRateOnly.average_heartrate, 150);
  assert.equal('average_watts' in heartRateOnly, false);
  assert.equal('kudos_count' in heartRateOnly, false);
  assert.equal('start_latlng' in heartRateOnly, false);

  const powerOnly = toSharedActivityDTO(ACTIVITY, {
    ...DEFAULT_SHARE_LINK_FIELD_OPTIONS,
    power: true,
  });
  assert.equal(powerOnly.average_watts, 200);
  assert.equal('average_heartrate' in powerOnly, false);

  const socialOnly = toSharedActivityDTO(ACTIVITY, {
    ...DEFAULT_SHARE_LINK_FIELD_OPTIONS,
    social: true,
  });
  assert.equal(socialOnly.kudos_count, 12);
  assert.equal('average_watts' in socialOnly, false);

  const locationOnly = toSharedActivityDTO(ACTIVITY, {
    ...DEFAULT_SHARE_LINK_FIELD_OPTIONS,
    preciseLocation: true,
  });
  assert.deepEqual(locationOnly.start_latlng, [47.1, 8.5]);
  assert.equal('kudos_count' in locationOnly, false);
});

void test('the schema itself is a strict allow-list (unknown keys are stripped/rejected)', () => {
  const result = sharedActivityDTOSchema.safeParse({
    id: '1',
    name: 'x',
    sport_type: 'Run',
    start_date: new Date().toISOString(),
    start_date_local: new Date().toISOString(),
    timezone: 'UTC',
    distance: null,
    moving_time: null,
    elapsed_time: null,
    total_elevation_gain: null,
    average_speed: null,
    max_speed: null,
    elev_high: null,
    elev_low: null,
    map_summary_polyline: null,
    map_bbox: null,
    trainer: null,
    commute: null,
    manual: null,
    // Fields that must never leak, smuggled in on an otherwise-valid object.
    description: 'should never survive parsing',
    average_heartrate: 999,
  });

  assert.ok(result.success);
  if (result.success) {
    assert.equal('description' in result.data, false);
    // average_heartrate is a legitimate optional key in the schema (gated by
    // the DTO builder above, not by the schema itself) - this only proves
    // the truly-unlisted key (`description`) does not survive.
  }
});
