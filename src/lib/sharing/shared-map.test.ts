import assert from 'node:assert/strict';

import polyline from '@mapbox/polyline';
import test from 'node:test';

import type { SharedActivityDTO } from '~/contracts/share/activity';
import { routeBounds } from '~/lib/route-framing';

import { buildSharedRouteCollection } from './shared-map';

function activity(
  overrides: Partial<SharedActivityDTO> = {},
): SharedActivityDTO {
  return {
    id: 'activity-1',
    name: 'Shared ride',
    sport_type: 'Ride',
    start_date_local: '2026-09-20T12:00:00.000Z',
    distance: 10_000,
    moving_time: 3600,
    total_elevation_gain: 250,
    average_speed: 2.78,
    route_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    elevation_profile: null,
    ...overrides,
  };
}

void test('buildSharedRouteCollection decodes only the explicitly shared routes', () => {
  const collection = buildSharedRouteCollection([
    activity(),
    activity({ id: 'activity-without-route', route_polyline: null }),
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

void test('recipient route framing keeps a disclosed date-line crossing local', () => {
  const routes = buildSharedRouteCollection([
    activity({
      route_polyline: polyline.encode([
        [10, 179],
        [11, -179],
      ]),
    }),
    activity({ id: 'not-disclosed', route_polyline: null }),
  ]);
  const bounds = routeBounds(
    routes.features.flatMap((feature) => feature.geometry.coordinates),
  )!;
  assert.ok(bounds[1][0] - bounds[0][0] < 2.001);
  assert.ok(bounds[0][1] < 10 && bounds[1][1] > 11);
});
