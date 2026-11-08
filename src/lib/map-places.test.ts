import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import test from 'node:test';

import type { MatchedPlace } from '~/contracts/activity-places';

import {
  groupMapPlaces,
  mapPlaceClusterKind,
  mapPlacePolicy,
} from './map-places';

void test('web and iOS share the place grouping policy and layout cases', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../shared/parity/map-places.v1.json', import.meta.url),
      'utf8',
    ),
  ) as {
    policy: typeof mapPlacePolicy;
    symbols: { kinds: MatchedPlace['kinds'][]; expected: string }[];
    cases: {
      name: string;
      width: number;
      height: number;
      focusedId?: string;
      points: { id: string; x: number; y: number }[];
      expected: string[][];
    }[];
  };
  assert.deepEqual(fixture.policy, mapPlacePolicy);
  for (const item of fixture.symbols) {
    assert.equal(
      mapPlaceClusterKind(item.kinds.map((kinds) => ({ kinds }))),
      item.expected,
    );
  }
  for (const item of fixture.cases) {
    assert.deepEqual(
      groupMapPlaces(item.points, item, item.focusedId).map(
        (group) => group.pointIDs,
      ),
      item.expected,
      item.name,
    );
  }
});

void test('nearby places group deterministically and repeated places count once', () => {
  const points = [
    { id: 'peak', x: 100, y: 100 },
    { id: 'hut', x: 110, y: 110 },
    { id: 'peak', x: 100, y: 100 },
    { id: 'pass', x: 300, y: 300 },
  ];
  const viewport = { width: 400, height: 400 };
  const groups = groupMapPlaces(points, viewport);
  assert.deepEqual(
    groups.map((group) => group.pointIDs),
    [['hut', 'peak'], ['pass']],
  );
  assert.deepEqual(groupMapPlaces([...points].reverse(), viewport), groups);
});

void test('dense overview preserves all places and the inspected place within the budget', () => {
  const points = Array.from({ length: 10000 }, (_, i) => ({
    id: String(i).padStart(5, '0'),
    x: (i % 100) * 30,
    y: Math.floor(i / 100) * 30,
  }));
  const groups = groupMapPlaces(points, { width: 3000, height: 3000 }, '00001');
  assert(groups.length <= mapPlacePolicy.maxMarkers);
  assert.deepEqual(
    new Set(groups.flatMap((group) => group.pointIDs)),
    new Set(points.map((point) => point.id)),
  );
  assert.deepEqual(groups.find((group) => group.id === '00001')?.pointIDs, [
    '00001',
  ]);
  assert(
    groups.every((group) =>
      points.some(
        (point) =>
          point.id === group.id && point.x === group.x && point.y === group.y,
      ),
    ),
  );
});

void test('offscreen and invalid places are excluded, including focused places', () => {
  assert.deepEqual(
    groupMapPlaces(
      [
        { id: 'outside', x: 1000, y: 1000 },
        { id: 'invalid', x: NaN, y: 100 },
      ],
      { width: 400, height: 400 },
      'outside',
    ),
    [],
  );
});
