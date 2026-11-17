import assert from 'node:assert/strict';

import test from 'node:test';
import { immer } from 'zustand/middleware/immer';
import { type StateCreator, createStore } from 'zustand/vanilla';

import { workspaceFor } from '~/lib/workspace';

import { initializeSportType } from './filter';
import { type StatsScopeSlice, createStatsScopeSlice } from './stats-scope';
import {
  allStatsSports,
  filterByStatsSports,
  initialStatsSports,
  sanitizeStatsSports,
} from './stats-scope';

const store = createStore<StatsScopeSlice>()(
  immer(
    createStatsScopeSlice as unknown as StateCreator<
      StatsScopeSlice,
      [['zustand/immer', never]]
    >,
  ),
);

void test('first-time stats scope includes mixed groups and falls back to all for no sports', () => {
  const types = initializeSportType();
  for (const key of Object.keys(types) as (keyof typeof types)[])
    types[key] = false;
  assert.deepEqual(initialStatsSports(types), allStatsSports());
  types.Run = true;
  assert.deepEqual(
    Object.entries(initialStatsSports(types))
      .filter(([, on]) => on)
      .map(([key]) => key),
    ['run'],
  );
});

void test('persisted scope keeps explicit empty selection, sanitizes malformed values and ignores unknown groups', () => {
  const fallback = allStatsSports();
  assert.deepEqual(sanitizeStatsSports(null, fallback), fallback);
  assert.deepEqual(sanitizeStatsSports([], fallback), fallback);
  assert.deepEqual(
    sanitizeStatsSports(
      { ...fallback, run: false, ride: 'yes', unknown: true },
      fallback,
    ),
    { ...fallback, run: false },
  );
  const empty = Object.fromEntries(
    Object.keys(fallback).map((key) => [key, false]),
  );
  assert.deepEqual(sanitizeStatsSports(empty, fallback), empty);
});

void test('stats actions are independent and reset selects every group', () => {
  store.getState().setStatsSports((sports) => ({ ...sports, run: false }));
  assert.equal(store.getState().statsSports.run, false);
  const persisted: unknown = JSON.parse(
    JSON.stringify(store.getState().statsSports),
  );
  assert.deepEqual(
    sanitizeStatsSports(persisted, allStatsSports()),
    store.getState().statsSports,
  );
  store.getState().resetStatsScope();
  assert.deepEqual(store.getState().statsSports, allStatsSports());
});

void test('Stats selects complete groups and workspaces share Map/List', () => {
  const sports = { ...allStatsSports(), run: false };
  assert.deepEqual(
    filterByStatsSports(
      [{ sport_type: 'Run' as const }, { sport_type: 'Ride' as const }],
      sports,
    ),
    [{ sport_type: 'Ride' }],
  );
  assert.equal(workspaceFor('/map'), 'activities');
  assert.equal(workspaceFor('/list'), 'activities');
  assert.equal(workspaceFor('/stats/tiles'), 'stats');
  assert.equal(workspaceFor('/stats-focus-preview'), 'stats');
  assert.equal(workspaceFor('/places/1'), 'places');
  assert.equal(workspaceFor('/mapping'), undefined);
});
