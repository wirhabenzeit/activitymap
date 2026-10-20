import assert from 'node:assert/strict';

import polyline from '@mapbox/polyline';
import test from 'node:test';

import { activityGPXCoordinates } from './activity-gpx';

void test('export uses detailed geometry and falls back from absent or invalid detail', () => {
  const detail: [number, number][] = [
    [46, 8],
    [47, 9],
  ];
  const summary = polyline.encode([[45, 7]]);
  assert.deepEqual(
    activityGPXCoordinates({
      map_polyline: polyline.encode(detail),
      map_summary_polyline: summary,
    }),
    [
      [8, 46],
      [9, 47],
    ],
  );
  for (const map_polyline of [null, '', polyline.encode([[120, 8]])]) {
    assert.deepEqual(
      activityGPXCoordinates({ map_polyline, map_summary_polyline: summary }),
      [[7, 45]],
    );
  }
  assert.deepEqual(
    activityGPXCoordinates({ map_polyline: null, map_summary_polyline: null }),
    [],
  );
  assert.deepEqual(
    activityGPXCoordinates({
      map_polyline: polyline.encode([[120, 8]]),
      map_summary_polyline: null,
    }),
    [],
  );
});
