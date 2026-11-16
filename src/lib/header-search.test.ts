import assert from 'node:assert/strict';

import test from 'node:test';
import { immer } from 'zustand/middleware/immer';
import { createStore } from 'zustand/vanilla';

import type { Activity } from '~/lib/activity';
import type { RootState } from '~/store';
import { createFilterSlice } from '~/store/filter';
import { createSelectionSlice } from '~/store/selection';

import {
  applyTextFilter,
  matchRange,
  matchedPlaceName,
  searchActivities,
  selectFromSearch,
  textFilterCount,
} from './header-search';

const place = (id: string, name: string) => ({
  id,
  name,
  kinds: ['peak'],
  latitude: 47,
  longitude: 8,
  elevationM: 2000,
  visits: [],
});
const activity = (
  id: number,
  name: string,
  date: string,
  places: ReturnType<typeof place>[] = [],
) =>
  ({
    id,
    name,
    sport_type: 'Ride',
    distance: 10_000,
    elapsed_time: 3600,
    total_elevation_gain: 100,
    commute: false,
    private: false,
    flagged: false,
    start_date_local: new Date(date),
    placeMatches: {
      status: 'complete',
      userId: 'alice',
      activityId: String(id),
      places,
    },
  }) as unknown as Activity;

const pilatus = place('00000000-0000-4000-8000-000000000001', 'Pilátus');
const activities = [
  activity(1, 'Morning ride', '2025-05-01T08:00:00Z', [pilatus]),
  activity(2, 'Lunch run', '2026-05-01T12:00:00Z', [pilatus]),
  activity(3, 'Pilatus loop', '2024-05-01T12:00:00Z'),
  activity(4, 'Evening walk', '2026-06-01T18:00:00Z'),
];

const setup = () => {
  const store = createStore<RootState>()(
    immer(
      (...args) =>
        ({
          ...createFilterSlice(...args),
          ...createSelectionSlice(...args),
          // The map slice imports maplibre; these are its search-facing parts.
          routeFitRequest: null,
          placeFlyRequest: null,
          searchPlace: null,
          requestRouteFit: (activityIDs: number[]) =>
            args[0]((state) => {
              state.routeFitRequest = { id: 'fit', activityIDs };
            }),
          requestPlaceFly: (latitude: number, longitude: number) =>
            args[0]((state) => {
              state.placeFlyRequest = { id: 'fly', latitude, longitude };
            }),
          setSearchPlace: (place: RootState['searchPlace']) =>
            args[0]((state) => {
              state.searchPlace = place;
            }),
        }) as RootState,
    ),
  );
  store.getState().reconcileSelection(
    activities.map((a) => a.id),
    activities.map((a) => a.id),
  );
  return store;
};

void test('activities match by name or visited place, newest first', () => {
  assert.deepEqual(
    searchActivities(activities, 'pilatus').map((a) => a.id),
    [2, 1, 3],
  );
  assert.deepEqual(searchActivities(activities, '  ').length, 0);
  assert.equal(matchedPlaceName(activities[0]!, 'PILATUS'), 'Pilátus');
  assert.equal(
    matchedPlaceName(activities[2]!, 'pilatus'),
    undefined,
    'the name itself matched',
  );
});

void test('match ranges are in the original text, with or without accents', () => {
  assert.deepEqual(matchRange('Pilátus', 'lat', true), [2, 5]);
  assert.equal(matchRange('Pilátus', 'lat'), undefined);
  assert.deepEqual(matchRange('Morning ride', 'RIDE'), [8, 12]);
  assert.deepEqual(matchRange('🚴 Ride', 'ride'), [3, 7]);
});

void test('picking an activity selects and frames it without touching filters', () => {
  const store = setup();
  store.getState().setSearchPlace({ id: 'x', name: 'x', userId: 'alice' });
  selectFromSearch(store, [2]);
  const state = store.getState();
  assert.deepEqual(state.selected, [2]);
  assert.equal(state.highlighted, 2);
  assert.deepEqual(state.routeFitRequest?.activityIDs, [2]);
  assert.equal(state.searchPlace, null, 'an activity pick clears the pin');
  assert.equal(state.search, '');
});

void test('picking a place selects its visible activities and pins it', () => {
  const store = setup();
  selectFromSearch(store, [1, 2], { ...pilatus, userId: 'alice' });
  let state = store.getState();
  assert.deepEqual([...state.selected].sort(), [1, 2]);
  assert.deepEqual(state.searchPlace?.id, pilatus.id);
  assert.deepEqual([...state.routeFitRequest!.activityIDs].sort(), [1, 2]);

  // Hidden by filters: nothing to select, so fly to the place itself.
  store.getState().reconcileSelection(
    activities.map((a) => a.id),
    [3, 4],
  );
  selectFromSearch(store, [1, 2], { ...pilatus, userId: 'alice' });
  state = store.getState();
  assert.deepEqual(state.selected, []);
  assert.equal(state.searchPlace?.id, pilatus.id);
  assert.deepEqual(
    [state.placeFlyRequest?.latitude, state.placeFlyRequest?.longitude],
    [47, 8],
  );
});

void test('applying the text filter counts and fits what the filters would show', () => {
  const store = setup();
  store.getState().setDateRange({ start: '2025-01-01', end: '2026-12-31' });
  assert.equal(
    textFilterCount(store.getState(), activities, 'pilatus', true),
    2,
  );
  assert.equal(
    textFilterCount(store.getState(), activities, 'pilatus', false),
    3,
    'Stats ignores the date range',
  );
  applyTextFilter(store, ' pilatus ', activities, true);
  assert.equal(store.getState().search, 'pilatus');
  assert.deepEqual(
    [...store.getState().routeFitRequest!.activityIDs].sort(),
    [1, 2],
  );
});
