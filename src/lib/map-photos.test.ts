import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  groupMapPhotos,
  mapPhotoPolicy,
  type ProjectedPhoto,
} from './map-photos';
const fixture = JSON.parse(
  readFileSync(
    new URL('../../shared/parity/map-photos.v1.json', import.meta.url),
    'utf8',
  ),
) as {
  policy: typeof mapPhotoPolicy;
  cases: {
    name: string;
    zoom: number;
    width: number;
    height: number;
    points: ProjectedPhoto[];
    expected: string[][];
  }[];
};
void test('policy matches native shared contract', () =>
  assert.deepEqual(mapPhotoPolicy, fixture.policy));
for (const c of fixture.cases)
  void test(c.name, () => {
    assert.deepEqual(
      groupMapPhotos(c.points, c).map((g) => g.photoIDs),
      c.expected,
    );
    assert.deepEqual(
      groupMapPhotos([...c.points].reverse(), c).map((g) => g.photoIDs),
      c.expected,
    );
  });
void test('dense viewport preserves every photo under the marker budget', () => {
  const points = Array.from({ length: 10000 }, (_, i) => ({
    id: String(i).padStart(5, '0'),
    x: (i % 100) * 30,
    y: Math.floor(i / 100) * 30,
  }));
  const groups = groupMapPhotos(points, {
    width: 3000,
    height: 3000,
    zoom: 15,
  });
  assert(groups.length <= 80 && groups.length > 1);
  assert.equal(groups.flatMap((g) => g.photoIDs).length, points.length);
  assert.deepEqual(
    new Set(groups.flatMap((g) => g.photoIDs)),
    new Set(points.map((p) => p.id)),
  );
  assert.deepEqual(
    groupMapPhotos([...points].reverse(), {
      width: 3000,
      height: 3000,
      zoom: 15,
    }),
    groups,
  );
});
void test('invalid projections cannot become map markers', () => {
  assert.deepEqual(
    groupMapPhotos(
      [
        { id: 'nan', x: NaN, y: 0 },
        { id: 'infinite', x: 0, y: Infinity },
      ],
      { width: 400, height: 700, zoom: 15 },
    ),
    [],
  );
});
