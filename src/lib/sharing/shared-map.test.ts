import assert from 'node:assert/strict';
import test from 'node:test';

import type { SharedActivityDTO } from '~/contracts/share/activity';

import { buildSharedRouteCollection } from './shared-map';

function activity(
  overrides: Partial<SharedActivityDTO> = {},
): SharedActivityDTO {
  return {
    id: 'activity-1',
    name: 'Shared ride',
    sport_type: 'Ride',
    start_date: '2026-09-20T10:00:00.000Z',
    start_date_local: '2026-09-20T12:00:00.000Z',
    timezone: 'Europe/Zurich',
    distance: 10_000,
    moving_time: 3600,
    elapsed_time: 3800,
    total_elevation_gain: 250,
    average_speed: 2.78,
    max_speed: 8,
    elev_high: 900,
    elev_low: 500,
    map_summary_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    map_bbox: null,
    trainer: false,
    commute: false,
    manual: false,
    ...overrides,
  };
}

void test('buildSharedRouteCollection decodes only the explicitly shared routes', () => {
  const collection = buildSharedRouteCollection([
    activity(),
    activity({ id: 'activity-without-route', map_summary_polyline: null }),
  ]);

  assert.equal(collection.features.length, 1);
  assert.equal(collection.features[0]?.id, 'activity-1');
  assert.deepEqual(collection.features[0]?.properties, {
    id: 'activity-1',
    sportType: 'Ride',
  });
  assert.deepEqual(collection.features[0]?.geometry.coordinates, [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ]);
});
