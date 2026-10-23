import assert from 'node:assert/strict';

import test from 'node:test';

import type { VisitedPlace } from '~/contracts/visited-places';

import { visibleVisitedPlaces } from './visited-places';

const place: VisitedPlace = {
  id: '6eef6c83-3451-413d-bbac-f21bec795843',
  name: 'Peak',
  kinds: ['peak'],
  elevationM: 2000,
  longitude: 8,
  latitude: 46,
  osmType: 'node',
  osmId: '123',
  activityIds: ['100', '200'],
};

void test('map places and counts follow the same activity visibility without duplicating points', () => {
  assert.deepEqual(visibleVisitedPlaces([place], []), []);
  assert.deepEqual(visibleVisitedPlaces([place], [300]), []);
  assert.deepEqual(visibleVisitedPlaces([place], [100, 100]), [
    { ...place, activityIds: ['100'] },
  ]);
  assert.deepEqual(visibleVisitedPlaces([place], [100, 200]), [place]);
  assert.deepEqual(place.activityIds, ['100', '200']);
});
