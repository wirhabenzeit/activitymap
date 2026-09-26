import assert from 'node:assert/strict';
import test from 'node:test';

import { statsTiles } from '~/settings/stats-tiles.generated';

import { placeBento } from './bento';

const starterSpans = statsTiles
  .filter((tile) => !('optional' in tile && tile.optional))
  .map((tile) => tile.span);

void test('packs the starter tiles on the 4-column grid without gaps', () => {
  assert.deepEqual(placeBento(starterSpans, 4), [
    { column: 1, row: 1, columns: 2, rows: 2 }, // year to date
    { column: 3, row: 1, columns: 2, rows: 1 }, // totals
    { column: 3, row: 2, columns: 2, rows: 1 }, // weekly volume
    { column: 1, row: 3, columns: 2, rows: 1 }, // activity calendar
    { column: 3, row: 3, columns: 1, rows: 1 }, // this month
    { column: 4, row: 3, columns: 1, rows: 1 }, // sport mix
    { column: 1, row: 4, columns: 1, rows: 1 }, // consistency
    { column: 2, row: 4, columns: 3, rows: 1 }, // distance vs elevation
  ]);
});

void test('clamps spans to the 2-column grid and fills the gap they leave', () => {
  assert.deepEqual(placeBento(starterSpans, 2), [
    { column: 1, row: 1, columns: 2, rows: 2 },
    { column: 1, row: 3, columns: 2, rows: 1 },
    { column: 1, row: 4, columns: 2, rows: 1 },
    { column: 1, row: 5, columns: 2, rows: 1 },
    { column: 1, row: 6, columns: 1, rows: 1 },
    { column: 2, row: 6, columns: 1, rows: 1 },
    { column: 1, row: 7, columns: 2, rows: 1 },
    { column: 1, row: 8, columns: 2, rows: 1 },
  ]);
});

void test('fills earlier holes with later small tiles', () => {
  assert.deepEqual(
    placeBento(
      [
        { columns: 1, rows: 1 },
        { columns: 3, rows: 1 },
        { columns: 1, rows: 1 },
      ],
      3,
    ),
    [
      { column: 1, row: 1, columns: 1, rows: 1 },
      { column: 1, row: 2, columns: 3, rows: 1 },
      { column: 2, row: 1, columns: 2, rows: 1 },
    ],
  );
});
