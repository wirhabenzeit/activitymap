import assert from 'node:assert/strict';

import test from 'node:test';

import { parseCoverageGeometry, parseCoveragePoly } from './coverage';

const square = (x = 0, y = 0, size = 10): number[][] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];
const geometry = (...polygons: number[][][][]) => ({
  type: 'MultiPolygon',
  coordinates: polygons,
});
const poly = (...sections: { name: string; ring: number[][] }[]): string =>
  [
    'provider region',
    ...sections.flatMap(({ name, ring }) => [
      name,
      ...ring.map((point) => point.join(' ')),
      'END',
    ]),
    'END',
    '',
  ].join('\n');

void test('parses scientific notation and normalizes winding without shifting vertices', () => {
  const text =
    'region\r\n1\r\n0E0 0E0\r\n0 1E1\r\n1E1 1E1\r\n1E1 0\r\n0 0\r\nEND\r\nEND\r\n';
  assert.deepEqual(parseCoveragePoly(text), geometry([square()]));
});

void test('preserves separate exteriors and assigns holes by containment, not section order', () => {
  const hole = square(2, 2, 1);
  const result = parseCoveragePoly(
    poly(
      { name: 'first', ring: square() },
      { name: 'second', ring: square(20, 20) },
      { name: '!first-hole', ring: hole },
    ),
  );
  assert.deepEqual(
    result,
    geometry([square(), [...hole].reverse()], [square(20, 20)]),
  );
  assert.deepEqual(parseCoverageGeometry(result), result);
});

void test('GeoJSON validation clones input and normalizes hole winding', () => {
  const input = geometry([square(), square(2, 2, 1)]);
  const before = structuredClone(input);
  const parsed = parseCoverageGeometry(input);
  assert.deepEqual(input, before);
  assert.notEqual(parsed.coordinates, input.coordinates);
  assert.deepEqual(parsed.coordinates[0]![1], [...square(2, 2, 1)].reverse());
});

void test('rejects malformed poly delimiters, empty files and trailing documents', () => {
  for (const text of [
    '',
    'END',
    'name\nEND',
    'name\n!\nEND\nEND',
    poly({ name: '1', ring: square() }).replace(/END\nEND\n$/, 'END\n'),
    poly({ name: '1', ring: square() }).replace(/END\nEND\n$/, ''),
    `${poly({ name: '1', ring: square() })}another\nEND`,
  ])
    assert.throws(() => parseCoveragePoly(text));
});

void test('rejects nonnumeric, nonfinite, out-of-bounds and extra coordinates', () => {
  for (const coordinate of [
    'NaN 0',
    'Infinity 0',
    '1e999 0',
    '0x1 0',
    '181 0',
    '0 -91',
    '0 0 0',
    '0',
  ]) {
    assert.throws(() =>
      parseCoveragePoly(
        poly({ name: '1', ring: square() }).replace('0 0', coordinate),
      ),
    );
  }
  for (const position of [
    [NaN, 0],
    [Infinity, 0],
    [0, 91],
    [-181, 0],
    [0, 0, 2],
    ['0', 0],
  ]) {
    const ring = square();
    assert.throws(() =>
      parseCoverageGeometry(
        geometry([[position, ...ring.slice(1)]] as number[][][]),
      ),
    );
  }
});

void test('rejects unclosed, short, zero-area, repeated and backtracking rings', () => {
  for (const ring of [
    square().slice(0, -1),
    [
      [0, 0],
      [1, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [10, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [0, 0],
      [10, 0],
      [5, 0],
      [5, 10],
      [0, 10],
      [0, 0],
    ],
  ])
    assert.throws(() => parseCoverageGeometry(geometry([ring])));
});

void test('rejects self crossings and self touches even with nonzero signed area', () => {
  for (const ring of [
    [
      [0, 0],
      [4, 4],
      [0, 4],
      [4, 0],
      [5, 1],
      [0, 0],
    ],
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [2, 0],
      [0, 4],
      [0, 0],
    ],
  ])
    assert.throws(
      () => parseCoverageGeometry(geometry([ring])),
      /self-intersect|self-touch/,
    );
});

void test('rejects boundary-touching and crossing holes instead of clipping them', () => {
  for (const hole of [square(0, 2, 2), square(9, 2, 2)]) {
    assert.throws(
      () =>
        parseCoveragePoly(
          poly(
            { name: 'outer', ring: square() },
            { name: '!hole', ring: hole },
          ),
        ),
      /intersect or touch/,
    );
  }
});

void test('rejects orphan and misassigned holes', () => {
  assert.throws(
    () => parseCoveragePoly(poly({ name: '!hole', ring: square() })),
    /exterior/,
  );
  assert.throws(
    () =>
      parseCoveragePoly(
        poly(
          { name: 'outer', ring: square() },
          { name: '!hole', ring: square(20, 20, 1) },
        ),
      ),
    /exactly one exterior/,
  );
  assert.throws(
    () =>
      parseCoverageGeometry(
        geometry([square(), square(21, 21, 1)], [square(20, 20)]),
      ),
    /strictly inside/,
  );
});

void test('rejects overlapping or nested holes and overlapping or nested exteriors', () => {
  for (const input of [
    geometry([square(), square(1, 1, 4), square(2, 2, 1)]),
    geometry([square(), square(1, 1, 4), square(3, 3, 4)]),
    geometry([square()], [square(2, 2, 1)]),
    geometry([square()], [square(5, 5)]),
    geometry([square()], [square(10, 10)]),
  ])
    assert.throws(() => parseCoverageGeometry(input));
});

void test('rejects unsplit antimeridian geometry but accepts separate polygons on either side', () => {
  assert.throws(
    () =>
      parseCoverageGeometry(
        geometry([
          [
            [179, 0],
            [-179, 0],
            [-179, 1],
            [179, 1],
            [179, 0],
          ],
        ]),
      ),
    /must be split/,
  );
  const split = geometry([square(179, 0, 1)], [square(-180, 0, 1)]);
  assert.deepEqual(parseCoverageGeometry(split), split);
});

void test('valid collinear vertices and very small nonzero geometry are preserved', () => {
  const collinear = [
    [0, 0],
    [5, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  assert.deepEqual(
    parseCoverageGeometry(geometry([collinear])),
    geometry([collinear]),
  );
  const tiny = square(0, 0, Number.MIN_VALUE);
  assert.deepEqual(parseCoverageGeometry(geometry([tiny])), geometry([tiny]));
});

void test('requires the exact two-dimensional MultiPolygon shape', () => {
  for (const input of [
    null,
    {},
    { type: 'Polygon', coordinates: [square()] },
    geometry(),
    geometry([]),
    { ...geometry([square()]), crs: 'unknown' },
  ]) {
    assert.throws(() => parseCoverageGeometry(input));
  }
});
