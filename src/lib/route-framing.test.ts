import assert from 'node:assert/strict';
import test from 'node:test';
import polyline from '@mapbox/polyline';
import {
  routeBounds,
  routeCoordinates,
  routeFitPadding,
} from './route-framing';

void test('date-line routes use the short arc regardless of coordinate order', () => {
  const points = [
    [179.8, -17],
    [-179.7, -16.8],
    [179.9, -16.9],
  ];
  const bounds = routeBounds(points)!;
  assert.ok(bounds[1][0] - bounds[0][0] < 0.501);
  assert.deepEqual(routeBounds([...points].reverse()), bounds);
  assert.ok(bounds[0][1] < -17 && bounds[1][1] > -16.8);
});

void test('empty/invalid geometry has no fit, while points have a finite extent', () => {
  assert.equal(routeBounds([]), null);
  assert.equal(
    routeBounds([
      [NaN, 5],
      [8, 91],
      [181, 0],
    ]),
    null,
  );
  const point = routeBounds([[8, 46]])!;
  assert.ok(point.flat().every(Number.isFinite));
  assert.ok(point[0][0] < 8 && point[1][0] > 8);
  assert.ok(point[0][1] < 46 && point[1][1] > 46);
});

void test('framing uses the same summary geometry as the rendered route', () => {
  assert.deepEqual(
    routeCoordinates({
      map_summary_polyline: polyline.encode([
        [46, 8],
        [47, 9],
      ]),
      map_polyline: polyline.encode([[1, 2]]),
    }),
    [
      [8, 46],
      [9, 47],
    ],
  );
  assert.deepEqual(
    routeCoordinates({ map_summary_polyline: null, map_polyline: null }),
    [],
  );
});

void test('measured phone panel and text scaling reserve the visible area', () => {
  const map = { left: 72, top: 84, right: 375, bottom: 667 };
  const panel = { left: 84, top: 316, right: 363, bottom: 655 };
  const padding = routeFitPadding(map, panel)!;
  assert.ok(map.bottom - padding.bottom < panel.top);
  assert.ok(map.bottom - map.top - padding.top - padding.bottom >= 80);
});

void test('a tall side panel leaves a usable rectangle to its left', () => {
  const map = { left: 320, top: 56, right: 1500, bottom: 900 };
  const panel = { left: 1100, top: 80, right: 1480, bottom: 880 };
  const padding = routeFitPadding(map, panel)!;
  assert.ok(map.right - padding.right < panel.left);
  assert.equal(
    routeFitPadding({ left: 0, top: 0, right: 100, bottom: 100 }),
    null,
  );
  assert.equal(routeFitPadding(map, { ...map }), null);
});

void test('a larger but unusably narrow strip does not hide a valid fit', () => {
  const map = { left: 0, top: 0, right: 400, bottom: 1200 };
  const panel = { left: 120, top: 150, right: 400, bottom: 1200 };
  const padding = routeFitPadding(map, panel)!;
  assert.ok(padding);
  assert.equal(padding.bottom, 1074);
  assert.equal(padding.right, 64);
});
