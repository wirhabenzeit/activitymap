import assert from 'node:assert/strict';
import test from 'node:test';

import { trimRouteEnds, type LatLng } from './route-trim';

// Due north from the equator: 0.001° of latitude is ~111.2 m.
const north = (count: number): LatLng[] =>
  Array.from({ length: count }, (_, index) => [index * 0.001, 0]);

void test('cuts exactly the trim distance from both ends', () => {
  const trimmed = trimRouteEnds(north(11), 200);

  assert.ok(Math.abs(trimmed[0]![0] * 111_195 - 200) < 1);
  assert.ok(Math.abs((0.01 - trimmed[trimmed.length - 1]![0]) * 111_195 - 200) < 1);
  // Interior points strictly between the cuts are kept unchanged.
  assert.deepEqual(trimmed.slice(1, -1), north(11).slice(2, 9));
});

void test('returns nothing when less than another trim length would remain', () => {
  assert.deepEqual(trimRouteEnds(north(6), 200), []);
  assert.deepEqual(trimRouteEnds(north(1), 200), []);
});

void test('tolerates repeated points', () => {
  const points: LatLng[] = [[0, 0], [0, 0], ...north(11).slice(1), [0.01, 0]];
  const trimmed = trimRouteEnds(points, 200);

  assert.ok(trimmed.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)));
  assert.ok(Math.abs(trimmed[0]![0] * 111_195 - 200) < 1);
});
