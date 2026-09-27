import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from 'zustand/vanilla';
import { immer } from 'zustand/middleware/immer';
import { type StateCreator } from 'zustand';
import { filterStatsActivities, statsFilterScope } from './filter-scope';
import { dayFromISODate, yearToDate } from './tile-data';
import { toStatsActivity } from './tile-series';
import {
  createFilterSlice,
  type FilterSlice,
  initializeSportType,
  initializeSportGroup,
  initializeValues,
  initializeBinary,
  type FilterState,
  type FilterableActivity,
} from '~/store/filter';
import { type Activity } from '~/server/db/schema';

const state = (): FilterState => ({
  sportType: initializeSportType(),
  sportGroup: initializeSportGroup(),
  dateRange: { start: '2026-01-01', end: '2026-12-31' },
  values: initializeValues(),
  binary: initializeBinary(),
  search: '',
});
const activity = (year: number, extra: Partial<FilterableActivity> = {}) => ({
  start_date_local: new Date(`${year}-01-01T12:00:00Z`),
  sport_type: 'Ride' as const,
  name: 'Morning ride',
  distance: 10000,
  moving_time: 3600,
  total_elevation_gain: 100,
  elapsed_time: 4000,
  commute: false,
  private: false,
  flagged: false,
  ...extra,
});

void test('stats keep comparison history while applying every other activity constraint', () => {
  const filters = state();
  filters.sportType.Run = false;
  filters.search = 'morning';
  filters.binary.commute = 'no';
  filters.binary.private = 'no';
  filters.binary.flagged = 'no';
  filters.values.distance = { operator: '>=', value: 5000 };
  filters.values.elapsed_time = { operator: '<=', value: 5000 };
  filters.values.total_elevation_gain = { operator: '>=', value: 100 };
  const previous = activity(2025),
    current = activity(2026);
  const excluded = [
    { sport_type: 'Run' as const },
    { name: 'Evening ride' },
    { commute: true },
    { private: true },
    { flagged: true },
    { distance: 1000 },
    { elapsed_time: 6000 },
    { total_elevation_gain: 50 },
  ];
  const selected = filterStatsActivities(
    [previous, current, ...excluded.map((extra) => activity(2026, extra))],
    filters,
  );
  assert.deepEqual(selected, [previous, current]);
  assert.deepEqual(
    yearToDate(
      selected.map((a) => toStatsActivity(a as Activity)),
      dayFromISODate('2026-09-27'),
      'distance',
    ),
    { current: 10, previous: 10 },
  );
  assert.deepEqual(filters.dateRange, {
    start: '2026-01-01',
    end: '2026-12-31',
  });
});

void test('date range alone is not an activity-scope indicator; single-category subsets are', () => {
  const filters = state();
  assert.deepEqual(statsFilterScope(filters), {
    filtered: false,
    labels: [],
    singleSport: false,
  });
  for (const key of Object.keys(
    filters.sportType,
  ) as (keyof typeof filters.sportType)[])
    filters.sportType[key] = key === 'Ride';
  const scope = statsFilterScope(filters);
  assert.equal(scope.singleSport, true);
  assert.equal(scope.filtered, true);
  assert.deepEqual(scope.labels, ['Ride (some types)']);
});

void test('clearing stats activity filters preserves the hidden date range', () => {
  const store = createStore<FilterSlice>()(
    immer(
      createFilterSlice as unknown as StateCreator<
        FilterSlice,
        [['zustand/immer', never]],
        [],
        FilterSlice
      >,
    ),
  );
  const range = { start: '2024-01-01', end: '2024-12-31' };
  store.getState().setDateRange(range);
  store.getState().setSearch('ride');
  store
    .getState()
    .setValues((values) => ({
      ...values,
      distance: { operator: '>=', value: 10000 },
    }));
  store.getState().setBinary((binary) => ({ ...binary, commute: 'no' }));
  store.getState().setSportType((types) => ({ ...types, Run: false }));
  store.getState().resetActivityFilters();
  assert.deepEqual(store.getState().dateRange, range);
  assert.equal(statsFilterScope(store.getState()).filtered, false);
  store.getState().resetFilters();
  assert.equal(store.getState().dateRange, undefined);
});
