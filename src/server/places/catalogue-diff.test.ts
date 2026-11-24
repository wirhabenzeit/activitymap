import assert from 'node:assert/strict';

import test from 'node:test';

import { diffCatalogue } from './catalogue-diff';
import { type PlaceRow, tileOf } from './catalogue-rows';

const place = (id: string, longitude: number, displayName = id): PlaceRow => ({
  id,
  displayName,
  kinds: ['peak'],
  subtypes: ['peak'],
  location: { longitude, latitude: 46.1 },
});
const live = (row: PlaceRow, hash: string) => ({
  key: row.id,
  hash,
  tile: tileOf(row.location),
});

void test('a diff lists inserts, updates in place, moves and deletes, and their tiles', () => {
  const kept = place('a', 8.1);
  const renamed = place('b', 8.2);
  const moved = place('c', 8.3);
  const gone = place('d', 9.1);
  const added = place('e', 9.6);
  const diff = diffCatalogue(
    [
      { place: kept, hash: 'h-a' },
      { place: { ...renamed, displayName: 'B' }, hash: 'h-b2' },
      {
        place: { ...moved, location: { ...moved.location, longitude: 8.6 } },
        hash: 'h-c2',
      },
      { place: added, hash: 'h-e' },
    ],
    [
      live(kept, 'h-a'),
      live(renamed, 'h-b'),
      live(moved, 'h-c'),
      live(gone, 'h-d'),
    ],
  );
  assert.deepEqual(
    diff.inserts.map(({ id }) => id),
    ['e'],
  );
  assert.deepEqual(
    diff.updates.map(({ place, moved }) => [place.id, moved]),
    [
      ['b', false],
      ['c', true],
    ],
  );
  assert.deepEqual(diff.deletes, ['d']);
  assert.equal(diff.unchanged, 1);
  // Both tiles of the moved place.
  assert.deepEqual(
    [...diff.tiles].sort(),
    [
      tileOf({ longitude: 8.2, latitude: 46.1 }),
      tileOf({ longitude: 8.3, latitude: 46.1 }),
      tileOf({ longitude: 8.6, latitude: 46.1 }),
      tileOf({ longitude: 9.1, latitude: 46.1 }),
      tileOf({ longitude: 9.6, latitude: 46.1 }),
    ].sort(),
  );
});

void test('an artifact equal to the live rows has no difference', () => {
  const rows = [place('a', 8.1), place('b', 12.4)];
  const diff = diffCatalogue(
    rows.map((row) => ({ place: row, hash: `h-${row.id}` })),
    rows.map((row) => live(row, `h-${row.id}`)),
  );
  assert.deepEqual(
    [diff.inserts, diff.updates, diff.deletes, diff.unchanged, diff.tiles.size],
    [[], [], [], 2, 0],
  );
});

void test('the live catalogue cannot list a place twice', () => {
  const row = place('a', 8.1);
  assert.throws(
    () => diffCatalogue([], [live(row, 'h'), live(row, 'h')]),
    /twice/,
  );
});
