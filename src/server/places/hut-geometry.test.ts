import assert from 'node:assert/strict';

import test from 'node:test';

import {
  assembleRings,
  hutInteriorPoint,
  hutRelationWays,
  resolveHutPoint,
} from './hut-geometry';
import type { OsmSource } from './osm-pbf';

const locations = new Map<string, [number, number]>([
  ['0', [0, 0]],
  ['1', [4, 0]],
  ['2', [4, 4]],
  ['3', [0, 4]],
  ['4', [1, 1]],
  ['5', [1, 3]],
  ['6', [3, 3]],
  ['7', [3, 1]],
]);
void test('hut point stays inside a concave building or courtyard and handles reversed split rings', () => {
  const outer = [
      ['0', '1', '2'],
      ['0', '3', '2'],
    ],
    holes = [['4', '5', '6', '7', '4']];
  assert.deepEqual(assembleRings(outer), [['0', '3', '2', '1', '0']]);
  const point = hutInteriorPoint(outer, holes, locations);
  assert(point[0] > 0 && point[0] < 4 && point[1] > 0 && point[1] < 4);
  assert(!(point[0] > 1 && point[0] < 3 && point[1] > 1 && point[1] < 3));
  const concave = new Map<string, [number, number]>([
    ['0', [0, 0]],
    ['1', [4, 0]],
    ['2', [4, 1]],
    ['3', [1, 1]],
    ['4', [1, 4]],
    ['5', [0, 4]],
  ]);
  const inside = hutInteriorPoint(
    [['0', '1', '2', '3', '4', '5', '0']],
    [],
    concave,
  );
  assert(inside[0] > 0 && inside[1] > 0 && (inside[0] < 1 || inside[1] < 1));
  const multiple = new Map(locations);
  for (const [id, xy] of locations) multiple.set(`b${id}`, [xy[0] + 10, xy[1]]);
  const multi = hutInteriorPoint(
    [
      ['0', '1', '2', '3', '0'],
      ['b0', 'b1', 'b2', 'b3', 'b0'],
    ],
    [],
    multiple,
  );
  assert(multi[0] > 0 && multi[0] < 4);
});
void test('unsupported topology and unresolved hut geometry fail instead of inventing a point', () => {
  for (const outer of [
    [['0', '2', '1', '3', '0']],
    [['0', '1', 'missing', '0']],
    [
      ['0', '1'],
      ['1', '2'],
    ],
    [
      ['0', '1', '2', '0'],
      ['0', '3', '2'],
    ],
    [
      ['0', '1', '2', '3', '0'],
      ['0', '1', '2', '0'],
    ],
  ])
    assert.throws(() => hutInteriorPoint(outer, [], locations));
  assert.throws(() =>
    hutInteriorPoint(
      [['4', '5', '6', '7', '4']],
      [['0', '1', '2', '3', '0']],
      locations,
    ),
  );
  const relation: OsmSource = {
    osm_type: 'relation',
    osm_id: '1',
    tags: { type: 'multipolygon' },
    members: [{ type: 'relation', ref: '2', role: 'outer' }],
  };
  assert.throws(() => hutRelationWays(relation));
  relation.members = [{ type: 'way', ref: '2', role: '' }];
  assert.throws(() => hutRelationWays(relation));
  relation.members = [
    { type: 'way', ref: '2', role: 'outer' },
    { type: 'way', ref: '2', role: 'inner' },
  ];
  assert.throws(() => hutRelationWays(relation));
  assert.throws(() =>
    resolveHutPoint(
      { osm_type: 'way', osm_id: '1', tags: { area: 'no' } },
      new Map([['1', ['0', '1', '2', '3', '0']]]),
      locations,
    ),
  );
});
