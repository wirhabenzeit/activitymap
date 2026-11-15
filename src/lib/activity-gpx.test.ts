import assert from 'node:assert/strict';

import polyline from '@mapbox/polyline';
import test from 'node:test';

import {
  activityGPXCoordinates,
  activityGPXDocument,
  activityGPXFileNames,
  routeWithElevation,
} from './activity-gpx';

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

void test('elevation is laid over the full route by distance travelled', () => {
  // Three points ~111 m apart along a meridian.
  const route: [number, number][] = [
    [8, 46],
    [8, 46.001],
    [8, 46.002],
  ];
  const points = routeWithElevation(route, {
    distance: [0, 100, 200, 300],
    altitude: [100, 110, 130, 100],
  });
  assert.deepEqual(
    points.map((point) => point[2]),
    [100, 120, 100],
  );
  assert.deepEqual(
    routeWithElevation(route, { distance: [0], altitude: [1] }),
    [
      [8, 46],
      [8, 46.001],
      [8, 46.002],
    ],
  );
  assert.deepEqual(routeWithElevation(route, null)[0], [8, 46]);
});

void test('the summary track is used when the activity has no route', () => {
  assert.deepEqual(
    routeWithElevation([], {
      latlng: [
        [46, 8],
        [47, 9],
      ],
      altitude: [500.04, 600],
    }),
    [
      [8, 46, 500],
      [9, 47, 600],
    ],
  );
  assert.deepEqual(routeWithElevation([], { altitude: [1] }), []);
});

void test('GPX documents escape text and include elevation', () => {
  const gpx = activityGPXDocument({
    name: 'Tom & "Jerry" <ride>',
    time: new Date('2026-11-01T08:00:00Z'),
    description: null,
    points: [
      [8, 46, 412.5],
      [8.5, 46.5],
    ],
  });
  assert.match(gpx, /<name>Tom &amp; &quot;Jerry&quot; &lt;ride&gt;<\/name>/);
  assert.match(gpx, /<trkpt lat="46" lon="8"><ele>412.5<\/ele><\/trkpt>/);
  assert.match(gpx, /<trkpt lat="46.5" lon="8.5"\/>/);
  assert.match(gpx, /<time>2026-11-01T08:00:00.000Z<\/time>/);
  assert.doesNotMatch(gpx, /<desc>/);
});

void test('archive file names are safe, dated and unique', () => {
  const day = new Date('2026-11-01T08:00:00Z');
  assert.deepEqual(
    activityGPXFileNames([
      { name: 'Morning Ride', start_date_local: day },
      { name: 'morning ride', start_date_local: day },
      { name: 'a/b:c', start_date_local: day },
      { name: '   ', start_date_local: day },
    ]),
    [
      '2026-11-01 Morning Ride.gpx',
      '2026-11-01 morning ride (2).gpx',
      '2026-11-01 a-b-c.gpx',
      '2026-11-01 Activity.gpx',
    ],
  );
});
