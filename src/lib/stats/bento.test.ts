import assert from 'node:assert/strict';
import test from 'node:test';

import { statsTiles } from '~/settings/stats-tiles.generated';

import { placeBento } from './bento';

// The web places each group (Now, This year, Patterns) on its own grid.
const groupSpans = (group: string) =>
  statsTiles
    .filter(
      (tile) => tile.group === group && !('optional' in tile && tile.optional),
    )
    .map((tile) => tile.span);

void test('packs each group of starter tiles on the 4-column grid', () => {
  assert.deepEqual(placeBento(groupSpans('now'), 4), [
    { column: 1, row: 1, columns: 1, rows: 1 }, // this week
    { column: 2, row: 1, columns: 2, rows: 1 }, // training volume
    { column: 4, row: 1, columns: 1, rows: 1 }, // this month
  ]);
  assert.deepEqual(placeBento(groupSpans('thisYear'), 4), [
    { column: 1, row: 1, columns: 2, rows: 1 }, // year to date
    { column: 3, row: 1, columns: 2, rows: 1 }, // pace, grown into the gap
    { column: 1, row: 2, columns: 4, rows: 1 }, // records, grown into the row
  ]);
  assert.deepEqual(placeBento(groupSpans('patterns'), 4), [
    { column: 1, row: 1, columns: 2, rows: 2 }, // activity calendar
    { column: 3, row: 1, columns: 1, rows: 1 }, // consistency
    { column: 4, row: 1, columns: 1, rows: 1 }, // sport mix
    { column: 3, row: 2, columns: 2, rows: 1 }, // climbing
    { column: 1, row: 3, columns: 1, rows: 1 }, // typical week
    { column: 2, row: 3, columns: 1, rows: 1 }, // best 30 days
    { column: 3, row: 3, columns: 2, rows: 1 }, // rest days, grown
  ]);
});

void test('clamps spans to the 2-column grid and fills the gaps they leave', () => {
  assert.deepEqual(placeBento(groupSpans('now'), 2), [
    { column: 1, row: 1, columns: 1, rows: 1 },
    { column: 1, row: 2, columns: 2, rows: 1 },
    { column: 2, row: 1, columns: 1, rows: 1 },
  ]);
  assert.deepEqual(placeBento(groupSpans('thisYear'), 2), [
    { column: 1, row: 1, columns: 2, rows: 1 },
    { column: 1, row: 2, columns: 2, rows: 1 },
    { column: 1, row: 3, columns: 2, rows: 1 },
  ]);
  assert.deepEqual(placeBento(groupSpans('patterns'), 2), [
    { column: 1, row: 1, columns: 2, rows: 2 },
    { column: 1, row: 3, columns: 1, rows: 1 },
    { column: 2, row: 3, columns: 1, rows: 1 },
    { column: 1, row: 4, columns: 2, rows: 1 },
    { column: 1, row: 5, columns: 1, rows: 1 },
    { column: 2, row: 5, columns: 1, rows: 1 },
    { column: 1, row: 6, columns: 2, rows: 1 },
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

void test('leaves gaps open when fillGaps is off', () => {
  assert.deepEqual(
    placeBento(
      [
        { columns: 4, rows: 2 },
        { columns: 1, rows: 1 },
        { columns: 1, rows: 1 },
      ],
      4,
      { fillGaps: false },
    ),
    [
      { column: 1, row: 1, columns: 4, rows: 2 },
      { column: 1, row: 3, columns: 1, rows: 1 },
      { column: 2, row: 3, columns: 1, rows: 1 },
    ],
  );
});
