import assert from 'node:assert/strict';

import type { GeometryCollection } from 'geojson';
import test from 'node:test';

import {
  type PlaceQueryWindow,
  placeQueryWindows,
  uniqueQueryWindows,
} from './query-windows';
import { EARTH_RADIUS_M } from './spatial-index';

const geometry = (...points: number[][]): GeometryCollection => ({
  type: 'GeometryCollection',
  geometries: [
    points.length === 1
      ? { type: 'Point', coordinates: points[0]! }
      : { type: 'LineString', coordinates: points },
  ],
});
const contains = (boxes: PlaceQueryWindow[], [lon, lat]: number[]) =>
  boxes.some(
    (b) =>
      lon! >= b.west && lon! <= b.east && lat! >= b.south && lat! <= b.north,
  );
function destination(
  lon: number,
  lat: number,
  bearing: number,
  metres: number,
): number[] {
  const rad = Math.PI / 180,
    a = lat * rad,
    l = lon * rad,
    b = bearing * rad,
    d = metres / EARTH_RADIUS_M;
  const y = Math.asin(
    Math.sin(a) * Math.cos(d) + Math.cos(a) * Math.sin(d) * Math.cos(b),
  );
  const x =
    l +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(a),
      Math.cos(d) - Math.sin(a) * Math.sin(y),
    );
  return [((x / rad + 540) % 360) - 180, y / rad];
}

void test('query windows retain the entire local discovery circle, including dateline and polar cases', () => {
  for (const [lon, lat] of [
    [8, 46],
    [179.999, 46],
    [-179.999, -46],
    [42, 89.999],
    [20, 90],
    [180, -90],
  ]) {
    const boxes = placeQueryWindows(geometry([lon!, lat!]), 300);
    for (let bearing = 0; bearing < 360; bearing += 5)
      assert(
        contains(boxes, destination(lon!, lat!, bearing, 304)),
        `Lost discovery point at ${lon},${lat}, bearing ${bearing}`,
      );
  }
});
void test('distant sections stay separate and dateline windows do not include the rest of the world', () => {
  const split: GeometryCollection = {
    type: 'GeometryCollection',
    geometries: [
      { type: 'Point', coordinates: [8, 46] },
      { type: 'Point', coordinates: [15, 47] },
    ],
  };
  const boxes = placeQueryWindows(split, 300);
  assert.equal(boxes.length, 2);
  assert(!contains(boxes, [11.5, 46.5]));
  const dateline = placeQueryWindows(
    geometry([179.999, 46], [-179.999, 46]),
    300,
  );
  assert.equal(dateline.length, 2);
  assert(contains(dateline, [180, 46]));
  assert(contains(dateline, [-180, 46]));
  assert(!contains(dateline, [0, 46]));
});
void test('windows enclose curved arc interiors rather than just recorded endpoints', () => {
  const boxes = placeQueryWindows(geometry([0, 80], [90, 80]), 300);
  assert(contains(boxes, [45, 82.8929]));
  assert(!contains(boxes, [45, 0]));
});
void test('window inputs are bounded and duplicate routes share the same query boxes', () => {
  const boxes = placeQueryWindows(geometry([8, 46]), 300);
  assert.deepEqual(uniqueQueryWindows([...boxes, ...boxes]), boxes);
  assert.throws(
    () => uniqueQueryWindows([{ west: 170, east: -170, south: 0, north: 1 }]),
    /Invalid/,
  );
  assert.throws(
    () => uniqueQueryWindows([{ west: 0, east: 1, south: 0, north: NaN }]),
    /Invalid/,
  );
});
