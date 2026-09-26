import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { type StateCreator } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { immer } from 'zustand/middleware/immer';

import { type SportType } from '~/server/db/schema.ts';
import {
  applyFilters,
  calendarDateFromLocalDate,
  createFilterSlice,
  deriveSportGroups,
  initializeBinary,
  initializeSportType,
  initializeValues,
  normalizeDateRange,
  parseValueFilterInput,
  sanitizePersistedBinary,
  sanitizePersistedDateRange,
  toPersistedValues,
  toggleSportGroupState,
  type BinaryColumn,
  type BinaryFilterMode,
  type FilterableActivity,
  type FilterSlice,
  type FilterState,
  type ValueColumn,
  type ValueFilter,
} from './filter.ts';

type FixtureActivity = FilterableActivity & { id: string };

type FixtureFilter = {
  search?: string;
  sport_types?: SportType[];
  date_range?: { start: string; end: string };
  values?: Partial<Record<ValueColumn, ValueFilter>>;
  binary?: Partial<Record<BinaryColumn, BinaryFilterMode>>;
};

type ActivityFixture = {
  activities: FixtureActivity[];
  filterCases: {
    name: string;
    filter: FixtureFilter;
    expected_ids: string[];
  }[];
};

const fixture = JSON.parse(
  readFileSync(
    new URL('../../shared/parity/activity-fixtures.v1.json', import.meta.url),
    'utf8',
  ),
) as ActivityFixture;

const stateFor = (filter: FixtureFilter): FilterState => {
  const sportType = initializeSportType();
  if (filter.sport_types) {
    const selected = new Set(filter.sport_types);
    for (const sportTypeName of Object.keys(sportType) as SportType[]) {
      sportType[sportTypeName] = selected.has(sportTypeName);
    }
  }

  return {
    sportType,
    sportGroup: deriveSportGroups(sportType),
    dateRange: filter.date_range,
    values: { ...initializeValues(), ...filter.values },
    search: filter.search ?? '',
    binary: { ...initializeBinary(), ...filter.binary },
  };
};

for (const fixtureCase of fixture.filterCases) {
  void test(`shared filter fixture: ${fixtureCase.name}`, () => {
    const state = stateFor(fixtureCase.filter);
    const actual = fixture.activities
      .filter((activity) => applyFilters(state, activity))
      .map((activity) => activity.id);

    assert.deepEqual(actual, fixtureCase.expected_ids);
  });
}

void test('invalid and inverted date restrictions are ignored', () => {
  const defaults = stateFor({});
  const activity = fixture.activities[0];
  assert.ok(activity);

  assert.equal(
    applyFilters(
      { ...defaults, dateRange: { start: 'invalid', end: 'also-invalid' } },
      activity,
    ),
    true,
  );
  assert.equal(
    applyFilters(
      { ...defaults, dateRange: { start: '2026-03-30', end: '2026-03-29' } },
      activity,
    ),
    true,
  );
  assert.equal(normalizeDateRange('2026-02-29', '2026-03-01'), undefined);
});

void test('active numeric filters reject non-finite values', () => {
  const state = stateFor({
    values: { distance: { operator: '>=', value: 0 } },
  });
  const activity = fixture.activities[0];
  assert.ok(activity);

  assert.equal(
    applyFilters(state, { ...activity, distance: Number.NaN }),
    false,
  );
  assert.equal(
    applyFilters(state, { ...activity, distance: Number.POSITIVE_INFINITY }),
    false,
  );
});

void test('picker dates become local calendar keys without UTC conversion', () => {
  const selected = new Date(2026, 2, 29, 0, 0, 0, 0);
  assert.equal(calendarDateFromLocalDate(selected), '2026-03-29');
});

void test('legacy persisted dates and binary defaults migrate safely', () => {
  const legacyStart = new Date(2026, 2, 1);
  const legacyEnd = new Date(2026, 2, 31, 23, 59, 59, 999);

  assert.deepEqual(
    sanitizePersistedDateRange({
      start: legacyStart.toISOString(),
      end: legacyEnd.toISOString(),
    }),
    { start: '2026-03-01', end: '2026-03-31' },
  );
  assert.equal(
    sanitizePersistedDateRange({
      start: '2026-02-30',
      end: '2026-03-01',
    }),
    undefined,
  );
  assert.equal(
    sanitizePersistedDateRange({ start: null, end: null }),
    undefined,
  );
  assert.deepEqual(
    sanitizePersistedBinary({ commute: false, private: false, flagged: false }),
    initializeBinary(),
  );
  assert.deepEqual(sanitizePersistedBinary({ private: 'yes' }), {
    commute: 'any',
    private: 'yes',
    flagged: 'any',
  });
});

void test('numeric input accepts only finite plain decimals', () => {
  assert.deepEqual(
    parseValueFilterInput('   ', '>=', (value) => value),
    {
      status: 'empty',
    },
  );
  assert.deepEqual(
    parseValueFilterInput('0x10', '>=', (value) => value),
    {
      status: 'invalid',
    },
  );
  assert.deepEqual(
    parseValueFilterInput('1e3', '<=', (value) => value),
    {
      status: 'invalid',
    },
  );
  assert.deepEqual(
    parseValueFilterInput(' .5 ', '<=', (value) => value * 1_000),
    {
      status: 'valid',
      filter: { value: 500, operator: '<=', displayValue: '.5' },
    },
  );
  assert.deepEqual(
    parseValueFilterInput('1.', '>=', () => Number.POSITIVE_INFINITY),
    { status: 'invalid' },
  );
});

void test('persisted numeric filters omit their editing draft', () => {
  assert.deepEqual(
    toPersistedValues({
      ...initializeValues(),
      distance: { value: 1_000, operator: '>=', displayValue: '1.' },
    }),
    {
      distance: { value: 1_000, operator: '>=' },
      elapsed_time: undefined,
      total_elevation_gain: undefined,
    },
  );
});

void test('group and individual sport changes stay synchronized', () => {
  const filterStore = createStore<FilterSlice>()(
    immer(
      createFilterSlice as unknown as StateCreator<
        FilterSlice,
        [['zustand/immer', never]],
        [],
        FilterSlice
      >,
    ),
  );

  filterStore.getState().setSportType((sportTypes) => ({
    ...sportTypes,
    Run: false,
  }));
  assert.equal(filterStore.getState().sportGroup.run, 'mixed');

  filterStore.getState().setSportGroup((groups) => ({
    ...groups,
    ride: false,
  }));
  assert.equal(filterStore.getState().sportType.Ride, false);
  assert.equal(filterStore.getState().sportType.VirtualRide, false);
  assert.equal(
    filterStore.getState().sportType.Run,
    false,
    'changing Ride must preserve the individual Run selection',
  );

  filterStore.getState().setSportGroup((groups) => ({
    ...groups,
    run: toggleSportGroupState(groups.run),
  }));
  assert.equal(filterStore.getState().sportGroup.run, true);
  assert.equal(filterStore.getState().sportType.Run, true);
  assert.equal(filterStore.getState().sportType.VirtualRun, true);

  filterStore.getState().setSportGroup((groups) => ({
    ...groups,
    run: toggleSportGroupState(groups.run),
  }));
  assert.equal(filterStore.getState().sportGroup.run, false);
  assert.equal(filterStore.getState().sportType.Run, false);
  assert.equal(filterStore.getState().sportType.VirtualRun, false);

  filterStore.getState().setValueOperator('distance', '<=');
  assert.equal(
    filterStore.getState().values.distance,
    undefined,
    'changing an empty operator must not activate a numeric filter',
  );
  filterStore.getState().setValues((values) => ({
    ...values,
    distance: { value: 0, operator: '>=' },
  }));
  filterStore.getState().setValueOperator('distance', '<=');
  assert.deepEqual(filterStore.getState().values.distance, {
    value: 0,
    operator: '<=',
  });

  filterStore.getState().resetFilters();
  assert.ok(Object.values(filterStore.getState().sportType).every(Boolean));
  assert.ok(
    Object.values(filterStore.getState().binary).every(
      (mode) => mode === 'any',
    ),
  );
});

void test('an invalid date update preserves the last valid active range', () => {
  const filterStore = createStore<FilterSlice>()(
    immer(
      createFilterSlice as unknown as StateCreator<
        FilterSlice,
        [['zustand/immer', never]],
        [],
        FilterSlice
      >,
    ),
  );
  const valid = { start: '2026-03-01', end: '2026-03-31' };
  filterStore.getState().setDateRange(valid);
  filterStore
    .getState()
    .setDateRange({ start: '2026-04-30', end: '2026-04-01' });

  assert.deepEqual(filterStore.getState().dateRange, valid);
});
