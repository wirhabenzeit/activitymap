import assert from 'node:assert/strict';
import test from 'node:test';

import polyline from '@mapbox/polyline';

import type { Activity } from '~/server/db/schema';
import { DEFAULT_SHARE_LINK_FIELD_OPTIONS } from '~/lib/sharing/fields';
import { SHARED_ROUTE_END_TRIM_METERS, type LatLng } from '~/lib/sharing/route-trim';
import { decodeStreamSummary } from '~/lib/streams/compact-summary';
import type { StreamSummary } from '~/server/strava/stream-summary';

import { sharedActivityDTOSchema, toSharedActivityDTO } from './activity.ts';

// About 1.5 km due east along 47°N, one point every ~76 m.
const ROUTE: LatLng[] = Array.from({ length: 21 }, (_, index) => [47, 8 + index * 0.001]);
const ROUTE_POLYLINE = polyline.encode(ROUTE);

function metersBetween([lat1, lng1]: LatLng, [lat2, lng2]: LatLng) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const x = radians(lng2 - lng1) * Math.cos(radians((lat1 + lat2) / 2));
  const y = radians(lat2 - lat1);
  return Math.hypot(x, y) * 6_371_000;
}

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
    map_summary_polyline: ROUTE_POLYLINE,
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

void test('shares exactly the track-level allow-list', () => {
  const dto = toSharedActivityDTO(ACTIVITY, DEFAULT_SHARE_LINK_FIELD_OPTIONS);

  assert.deepEqual(Object.keys(dto).sort(), [
    'average_speed',
    'distance',
    'elevation_profile',
    'id',
    'moving_time',
    'name',
    'route_polyline',
    'sport_type',
    'start_date_local',
    'total_elevation_gain',
  ]);
  assert.equal(dto.id, '42');
  assert.equal(dto.name, 'Activity 42');
  assert.equal(dto.distance, 5000);
});

void test('never exposes health, social, location or account fields, whatever the options', () => {
  for (const fields of [DEFAULT_SHARE_LINK_FIELD_OPTIONS, { showRouteEnds: true }]) {
    const dto = toSharedActivityDTO(ACTIVITY, fields) as Record<string, unknown>;
    for (const key of [
      'average_heartrate',
      'max_heartrate',
      'average_watts',
      'kilojoules',
      'calories',
      'kudos_count',
      'comment_count',
      'achievement_count',
      'athlete_count',
      'pr_count',
      'start_latlng',
      'end_latlng',
      'map_bbox',
      'map_summary_polyline',
      'map_polyline',
      'description',
      'gear_id',
      'upload_id',
      'athlete',
    ]) {
      assert.equal(key in dto, false, `expected "${key}" to never be shared`);
    }
  }
});

void test('trims both route ends by default', () => {
  const dto = toSharedActivityDTO(ACTIVITY, DEFAULT_SHARE_LINK_FIELD_OPTIONS);
  assert.ok(dto.route_polyline);
  const shared = polyline.decode(dto.route_polyline);

  const start = metersBetween(ROUTE[0]!, shared[0] as LatLng);
  const finish = metersBetween(ROUTE[ROUTE.length - 1]!, shared[shared.length - 1] as LatLng);
  assert.ok(Math.abs(start - SHARED_ROUTE_END_TRIM_METERS) < 2, `start trimmed by ${start} m`);
  assert.ok(Math.abs(finish - SHARED_ROUTE_END_TRIM_METERS) < 2, `finish trimmed by ${finish} m`);
});

void test('keeps the full route only when the athlete shows start and finish', () => {
  const dto = toSharedActivityDTO(ACTIVITY, { showRouteEnds: true });
  assert.equal(dto.route_polyline, ROUTE_POLYLINE);
});

void test('shares no route when too little would remain after trimming', () => {
  const short = buildActivity({
    id: 43,
    athlete: 1001,
    map_summary_polyline: polyline.encode(ROUTE.slice(0, 6)),
  });
  assert.equal(
    toSharedActivityDTO(short, DEFAULT_SHARE_LINK_FIELD_OPTIONS).route_polyline,
    null,
  );
  assert.equal(
    toSharedActivityDTO(buildActivity({ id: 44, athlete: 1001, map_summary_polyline: null }), {
      showRouteEnds: true,
    }).route_polyline,
    null,
  );
});

void test('the schema strips keys outside the allow-list', () => {
  const result = sharedActivityDTOSchema.safeParse({
    id: '1',
    name: 'x',
    sport_type: 'Run',
    start_date_local: new Date().toISOString(),
    distance: null,
    moving_time: null,
    total_elevation_gain: null,
    average_speed: null,
    route_polyline: null,
    elevation_profile: null,
    // Fields that must never leak, smuggled in on an otherwise-valid object.
    description: 'should never survive parsing',
    kudos_count: 12,
  });

  assert.ok(result.success);
  if (result.success) {
    assert.equal('description' in result.data, false);
    assert.equal('kudos_count' in result.data, false);
  }
});

// 1.5 km with a sample every 75 m, plus series that must never be shared.
const STREAM_SUMMARY: StreamSummary = {
  version: 1,
  basis: 'distance',
  distance: ROUTE.map((_, index) => index * 75),
  altitude: ROUTE.map((_, index) => 400 + index),
  latlng: ROUTE,
  time: ROUTE.map((_, index) => index * 20),
  heartrate: ROUTE.map(() => 150),
  watts: ROUTE.map(() => 200),
};

void test('shares an elevation profile trimmed like the route, without time, heart rate or power', () => {
  const dto = toSharedActivityDTO(ACTIVITY, DEFAULT_SHARE_LINK_FIELD_OPTIONS, STREAM_SUMMARY);
  assert.ok(dto.elevation_profile);
  assert.equal('heartrate' in dto.elevation_profile, false);
  assert.equal('time' in dto.elevation_profile, false);
  assert.equal('watts' in dto.elevation_profile, false);

  const profile = decodeStreamSummary(dto.elevation_profile);
  assert.deepEqual(profile.distance, [225, 300, 375, 450, 525, 600, 675, 750, 825, 900, 975, 1050, 1125, 1200, 1275]);
  assert.equal(profile.altitude?.[0], 403);
  assert.deepEqual(profile.latlng?.[0], ROUTE[3]);
  assert.equal(profile.heartrate, undefined);
});

void test('shares the whole elevation profile only when start and finish are shown', () => {
  const dto = toSharedActivityDTO(ACTIVITY, { showRouteEnds: true }, STREAM_SUMMARY);
  assert.ok(dto.elevation_profile);
  assert.equal(decodeStreamSummary(dto.elevation_profile).distance?.length, ROUTE.length);
});

void test('shares no elevation profile without a usable summary', () => {
  assert.equal(toSharedActivityDTO(ACTIVITY, DEFAULT_SHARE_LINK_FIELD_OPTIONS).elevation_profile, null);
  const short: StreamSummary = {
    ...STREAM_SUMMARY,
    distance: STREAM_SUMMARY.distance!.slice(0, 6),
    altitude: STREAM_SUMMARY.altitude!.slice(0, 6),
    latlng: undefined,
    time: undefined,
    heartrate: undefined,
    watts: undefined,
  };
  assert.equal(
    toSharedActivityDTO(ACTIVITY, DEFAULT_SHARE_LINK_FIELD_OPTIONS, short).elevation_profile,
    null,
  );
  const noAltitude: StreamSummary = { version: 1, basis: 'distance', distance: [0, 1000] };
  assert.equal(
    toSharedActivityDTO(ACTIVITY, { showRouteEnds: true }, noAltitude).elevation_profile,
    null,
  );
});
