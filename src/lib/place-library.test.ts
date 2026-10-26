import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import test from 'node:test';
import { immer } from 'zustand/middleware/immer';
import { type StateCreator, createStore } from 'zustand/vanilla';

import { activityDTOSchema } from '~/contracts/v1/activity';
import {
  filterStatsActivities,
  statsFilterScope,
} from '~/lib/stats/filter-scope';
import { dtoToActivityWithPlaces } from '~/lib/sync/v1-mappers';
import {
  type FilterSlice,
  applyFilters,
  createFilterSlice,
} from '~/store/filter';

import fixture from '../../shared/place-library-fixtures.v1.json';
import base from '../../shared/sync-integrity-fixtures.v1.json';
import {
  buildPlaceLibrary,
  sanitizePlaceFilter,
  searchLibraryPlaces,
} from './place-library';

const store = createStore<FilterSlice>()(
  immer(
    createFilterSlice as unknown as StateCreator<
      FilterSlice,
      [['zustand/immer', never]]
    >,
  ),
);

const activities = fixture.activities.map((row) =>
  dtoToActivityWithPlaces(
    activityDTOSchema.parse({
      ...base.activity,
      ...row,
      placeMatches: 'placeMatches' in row ? row.placeMatches : null,
    }),
    fixture.userId,
    fixture.matchingVersion,
  ),
);

void test('shared visit model fences freshness/ownership, preserves status and deduplicates repeated encounters', () => {
  const library = buildPlaceLibrary(activities, fixture.userId);
  assert.deepEqual(
    Object.fromEntries(
      library.places.map((place) => [place.id, place.activityCount]),
    ),
    fixture.expected.counts,
  );
  assert.deepEqual(library.statusCounts, fixture.expected.statusCounts);
  assert.equal(library.complete, false);
  assert.equal(
    library.byId.get(fixture.expected.placeFilter)?.firstVisit,
    '2025-05-01T12:00:00.000Z',
  );
  assert.equal(
    library.byId.get(fixture.expected.placeFilter)?.latestVisit,
    '2026-05-01T12:00:00.000Z',
  );
  assert.deepEqual(library.byId.get(fixture.expected.placeFilter)?.kinds, [
    'pass',
    'peak',
  ]);
  assert.equal(
    library.byId.get('00000000-0000-4000-8000-000000000003')?.elevationM,
    0,
  );
  assert.equal(
    activities[0]?.placeMatches?.places[0]?.visits.length,
    2,
    'index must not mutate profile encounters',
  );
  assert.equal(buildPlaceLibrary(activities, 'other').places.length, 0);
  assert.equal(
    buildPlaceLibrary(activities.slice(0, 4), fixture.userId).complete,
    true,
  );
  assert.equal(
    buildPlaceLibrary(activities.slice(0, 4), fixture.userId, false).complete,
    false,
  );
  assert.equal(buildPlaceLibrary([], fixture.userId, false).complete, false);
});

void test('autocomplete is bounded, accent insensitive, stable for duplicate names, and independent of filters', () => {
  const library = buildPlaceLibrary(activities, fixture.userId);
  const result = searchLibraryPlaces(library, 'PILATUS', 0, 1);
  assert.equal(result.total, 2);
  assert.equal(result.places.length, 1);
  assert.equal(result.places[0]?.activityCount, 2);
  assert.notEqual(
    searchLibraryPlaces(library, 'pilatus', 1, 1).places[0]?.id,
    result.places[0]?.id,
  );
  assert.deepEqual(searchLibraryPlaces(library, 'unknown').places, []);
});

void test('place filters intersect text/sport/date constraints and Stats retain comparison history', () => {
  store.getState().resetFilters();
  store.setState({
    place: {
      id: fixture.expected.placeFilter,
      name: 'Pilátus',
      userId: fixture.userId,
    },
    dateRange: { start: '2026-01-01', end: '2026-12-31' },
  });
  assert.deepEqual(
    activities
      .filter((activity) => applyFilters(store.getState(), activity))
      .map((a) => a.id),
    fixture.expected.browsingIds,
  );
  assert.deepEqual(
    filterStatsActivities(activities, store.getState()).map((a) => a.id),
    fixture.expected.statsIds,
  );
  assert.ok(
    statsFilterScope(store.getState()).labels.includes('Place: Pilátus'),
  );
  store.getState().setSearch('Morning');
  assert.equal(
    activities.filter((a) => applyFilters(store.getState(), a)).length,
    0,
  );
  assert.deepEqual(
    filterStatsActivities(activities, store.getState()).map((a) => a.id),
    [1],
  );
  store.getState().setSearch('Pilatus');
  assert.equal(
    filterStatsActivities(activities, store.getState()).length,
    0,
    'typing is still activity-name search',
  );
  store.getState().resetActivityFilters();
  assert.equal(store.getState().place, undefined);
  assert.ok(
    store.getState().dateRange,
    'Stats clear preserves reporting dates',
  );
  store.getState().resetFilters();
});

void test('restored filters are identity/owner scoped; replacements remove old memberships', () => {
  const place = {
    id: fixture.expected.placeFilter,
    name: 'Pilátus',
    userId: fixture.userId,
  };
  assert.deepEqual(sanitizePlaceFilter(place), place);
  for (const invalid of [
    null,
    {},
    { ...place, id: 'arbitrary' },
    { ...place, userId: '' },
  ])
    assert.equal(sanitizePlaceFilter(invalid), undefined);
  store.setState({ place });
  store.getState().resetFilters();
  assert.equal(store.getState().place, undefined);
  assert.equal(
    buildPlaceLibrary(activities.slice(1), fixture.userId).byId.get(place.id)
      ?.activityCount,
    1,
    'deletion updates membership',
  );
  const replaced = activities.map((a) =>
    a.id === 2 ? { ...a, placeMatches: { ...a.placeMatches!, places: [] } } : a,
  );
  assert.equal(
    buildPlaceLibrary(replaced, fixture.userId).byId.get(place.id)
      ?.activityCount,
    1,
    'completed zero replaces earlier matches',
  );
});

void test('representative 10000-activity index and autocomplete stay local and bounded', (t) => {
  const first = activities[0]!;
  const large = Array.from({ length: 10_000 }, (_, i) => ({
    ...first,
    id: i + 1,
    placeMatches: { ...first.placeMatches!, activityId: String(i + 1) },
  }));
  const start = performance.now();
  const library = buildPlaceLibrary(large, fixture.userId);
  const built = performance.now();
  const result = searchLibraryPlaces(library, 'pilatus');
  const searched = performance.now();
  assert.equal(result.places[0]?.activityCount, 10_000);
  t.diagnostic(
    `10000 activities: build ${(built - start).toFixed(1)} ms, search ${(searched - built).toFixed(1)} ms; ${library.places.length} distinct places`,
  );
});
