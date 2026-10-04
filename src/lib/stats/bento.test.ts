import assert from 'node:assert/strict';
import test from 'node:test';

import { statsTiles } from '~/settings/stats-tiles.generated';

import { placeBento, placeExpandedBento, bentoRowMinimums } from './bento';
import capabilities from '../../../shared/stats-capabilities.v1.json';

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
    { column: 2, row: 1, columns: 1, rows: 1 }, // this month
    { column: 3, row: 1, columns: 2, rows: 1 }, // training volume
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
    { column: 2, row: 1, columns: 1, rows: 1 },
    { column: 1, row: 2, columns: 2, rows: 1 },
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

void test('expansion shares the remaining row evenly for halves and thirds', () => {
  const spans = [
    { columns: 1, rows: 1 },
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
  ];
  assert.deepEqual(placeExpandedBento(spans, 4, 2), [
    { column: 1, row: 2, columns: 2, rows: 1 },
    { column: 3, row: 2, columns: 2, rows: 1 },
    { column: 1, row: 1, columns: 4, rows: 1 },
  ]);
  const thirds = placeExpandedBento([...spans, { columns: 1, rows: 1 }], 4, 2);
  for (const index of [0, 1, 3]) assert.equal(thirds[index]!.columns, 4 / 3);
});

void test('expanding every visible tile keeps complete rows without overlap at each breakpoint', () => {
  const visible = new Set(
    capabilities.tiles
      .filter((tile) => tile.visibility === 'visible')
      .map((tile) => tile.id),
  );
  for (const columns of [1, 2, 4])
    for (const group of ['now', 'thisYear', 'patterns']) {
      const tiles = statsTiles.filter(
        (tile) => tile.group === group && visible.has(tile.id),
      );
      for (let expanded = 0; expanded < tiles.length; expanded++) {
        const spans = tiles.map((tile) => tile.span);
        const placements = placeExpandedBento(spans, columns, expanded);
        assert.equal(placements[expanded]!.columns, columns);
        const lastRow = Math.max(
          ...placements.map((item) => item.row + item.rows - 1),
        );
        for (let row = 1; row <= lastRow; row++) {
          const items = placements
            .filter((item) => item.row <= row && item.row + item.rows > row)
            .sort((a, b) => a.column - b.column);
          let end = 1;
          for (const item of items) {
            assert.ok(
              Math.abs(item.column - end) < 1e-6,
              `${group}, ${columns} columns, expanded ${tiles[expanded]!.id}, row ${row}`,
            );
            end = item.column + item.columns;
          }
          assert.ok(Math.abs(end - (columns + 1)) < 1e-6);
        }
        assert.deepEqual(
          placeExpandedBento(spans, columns, -1),
          placeBento(spans, columns),
        );
      }
    }
});

void test('manifest height hints share row minima and account for multi-row gaps', () => {
  assert.deepEqual(
    bentoRowMinimums(
      [{ minHeight: 280 }, { minHeight: 300 }, {}],
      [
        { column: 1, row: 1, columns: 1, rows: 1 },
        { column: 2, row: 1, columns: 1, rows: 1 },
        { column: 1, row: 2, columns: 2, rows: 1 },
      ],
      216,
      12,
    ),
    [300, 216],
  );
  assert.deepEqual(
    bentoRowMinimums(
      [{ minHeight: 612 }],
      [{ column: 1, row: 1, columns: 2, rows: 2 }],
      216,
      12,
    ),
    [300, 300],
  );
});
