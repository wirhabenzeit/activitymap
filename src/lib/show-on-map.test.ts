import assert from 'node:assert/strict';
import test from 'node:test';
import polyline from '@mapbox/polyline';
import { createStore } from 'zustand/vanilla';
import { immer } from 'zustand/middleware/immer';
import type { RootState } from '~/store';
import type { Activity } from '~/server/db/schema';
import { createFilterSlice } from '~/store/filter';
import { createSelectionSlice } from '~/store/selection';
import { showActivityOnMap } from './show-on-map';

const activity = (id: number, name: string, gps = true) =>
  ({
    id,
    name,
    sport_type: 'Ride',
    start_date_local: new Date('2026-10-10T12:00:00Z'),
    map_summary_polyline: gps
      ? polyline.encode([
          [46, 8],
          [47, 9],
        ])
      : null,
    map_polyline: null,
  }) as Activity;
const activities = [
  activity(1, 'Visible'),
  activity(2, 'Hidden'),
  activity(3, 'No GPS', false),
];
const setup = () => {
  const store = createStore<RootState>()(
    immer(
      (...args) =>
        ({
          ...createFilterSlice(...args),
          ...createSelectionSlice(...args),
          routeFitRequest: null,
          requestRouteFit: (activityIDs: number[]) =>
            args[0]((state) => {
              state.routeFitRequest = { id: 'test-fit', activityIDs };
            }),
        }) as RootState,
    ),
  );
  store.getState().setSearch('Visible');
  store.getState().reconcileSelection([1, 2, 3], [1]);
  store.getState().setSelected([1]);
  return store;
};

void test('Show on map refuses hidden targets without explicit filter clearing', () => {
  const store = setup();
  assert.equal(
    showActivityOnMap(store, activities[1]!, activities, false),
    'hidden',
  );
  assert.deepEqual(store.getState().selected, [1]);
  assert.equal(store.getState().highlighted, 1);
  assert.equal(store.getState().search, 'Visible');
  assert.equal(store.getState().routeFitRequest, null);
});

void test('explicit clear-and-show activates immediately and preserves other selections', () => {
  const store = setup();
  store.getState().setSelected((ids) => [...ids, 2]);
  assert.equal(
    showActivityOnMap(store, activities[1]!, activities, true),
    'shown',
  );
  assert.equal(store.getState().search, '');
  assert.deepEqual(store.getState().selected, [1, 2]);
  assert.equal(store.getState().highlighted, 2);
  assert.deepEqual(store.getState().routeFitRequest?.activityIDs, [2]);
  store.getState().reconcileSelection([1, 2, 3], [1, 2, 3]);
  assert.equal(store.getState().highlighted, 2);
});

void test('visible Show on map retains filters, while GPS-less requests change nothing', () => {
  const store = setup();
  assert.equal(
    showActivityOnMap(store, activities[0]!, activities, false),
    'shown',
  );
  assert.equal(store.getState().search, 'Visible');
  const before = store.getState();
  assert.equal(
    showActivityOnMap(store, activities[2]!, activities, true),
    'no-route',
  );
  assert.equal(store.getState(), before);
});

void test('a deleted activity cannot clear filters, activate or request a camera fit', () => {
  const store = setup();
  store.getState().reconcileSelection([1, 3], [1]);
  const before = store.getState();
  assert.equal(
    showActivityOnMap(store, activities[1]!, activities, true),
    'unavailable',
  );
  assert.equal(store.getState(), before);
});
