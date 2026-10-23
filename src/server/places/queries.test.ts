import assert from 'node:assert/strict';

import test from 'node:test';

import { parsePlaceQueryFilters } from './queries';

void test('place query filters bound pagination and use inclusive local calendar dates', () => {
  assert.deepEqual(parsePlaceQueryFilters(), { limit: 50, offset: 0 });
  assert.deepEqual(
    parsePlaceQueryFilters({
      startDateLocal: '2026-10-22',
      endDateLocal: '2026-10-22',
      sportTypes: ['Hike'],
      relation: 'reached_peak',
      kind: 'peak',
      limit: 1,
    }),
    {
      startDateLocal: '2026-10-22',
      endDateLocal: '2026-10-22',
      sportTypes: ['Hike'],
      relation: 'reached_peak',
      kind: 'peak',
      limit: 1,
      offset: 0,
    },
  );
});

void test('place query filters reject ambiguous or unbounded input', () => {
  for (const input of [
    { limit: 0 },
    { limit: 101 },
    { offset: -1 },
    { offset: 10_001 },
    { limit: 1.5 },
    { startDateLocal: '2026-02-30' },
    { endDateLocal: '2026-10-22T00:00:00Z' },
    { startDateLocal: '2026-10-23', endDateLocal: '2026-10-22' },
    { sportTypes: [] },
    { sportTypes: ['Hike', 'Hike'] },
    { sportTypes: ['Flying'] },
    { relation: 'nearby' },
    { kind: 'settlement' },
    { athleteId: 1 },
  ])
    assert.throws(() => parsePlaceQueryFilters(input));
});
