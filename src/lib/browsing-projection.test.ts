import assert from 'node:assert/strict';

import test from 'node:test';
import { immer } from 'zustand/middleware/immer';
import { createStore } from 'zustand/vanilla';

import type { Activity } from '~/server/db/schema';
import type { RootState } from '~/store';
import { createFilterSlice } from '~/store/filter';

import {
  browsingIDs,
  emptySelection,
  selectionTransition,
} from './activity-selection';
import {
  committedSelectionIDs,
  projectActivities,
} from './browsing-projection';

function filters() {
  return createStore<RootState>()(
    immer((...args) => ({ ...createFilterSlice(...args) }) as RootState),
  ).getState();
}

void test('10,000 activity projection scans once and shares constant-time membership with every consumer', () => {
  let visited = 0;
  const activities = Array.from(
    { length: 10000 },
    (_, index) =>
      ({
        id: index + 1,
        get sport_type() {
          visited++;
          return 'Run';
        },
        name: `Activity ${index + 1}`,
        start_date_local: new Date('2026-10-01'),
      }) as Activity,
  );
  const state = filters();
  const projection = projectActivities(activities, state);
  assert.equal(visited, 10000);
  assert.equal(projection.filteredActivities.length, 10000);
  for (let consumer = 0; consumer < 4; consumer++) {
    for (const id of projection.filterIDs)
      assert(projection.filterIDSet.has(id));
  }
  // Four former map consumers independently scanned 40,000 records. Reading
  // the shared projection performs no further activity/filter derivation.
  assert.equal(visited, 10000);
  assert.equal(projection.filteredActivities[5000], activities[5000]);
  state.search = 'Activity 9999';
  assert.deepEqual(projectActivities(activities, state).filterIDs, [9999]);
});

void test('only complete committed libraries prune IDs; filters and selected-only scope retain hidden selection', () => {
  const activities = [
    { id: 1, sport_type: 'Run', name: 'Visible' },
    { id: 2, sport_type: 'Run', name: 'Hidden' },
  ] as Activity[];
  const state = filters();
  state.search = 'Visible';
  const projected = projectActivities(activities, state);
  let selection = {
    ...emptySelection(),
    selectedIDs: [1, 2, 999],
    onlySelected: true,
  };
  for (const records of [undefined, [], activities.slice(0, 1)]) {
    selection = selectionTransition(selection, {
      type: 'reconcile',
      knownIDs: committedSelectionIDs(records, false),
      eligibleIDs: projected.filterIDs,
    });
    assert.deepEqual(selection.selectedIDs, [1, 2, 999]);
  }
  selection = selectionTransition(selection, {
    type: 'reconcile',
    knownIDs: committedSelectionIDs(activities, true),
    eligibleIDs: projected.filterIDs,
  });
  assert.deepEqual(selection.selectedIDs, [1, 2]);
  assert.deepEqual(browsingIDs(selection, projected.filterIDs), [1]);
  assert.equal(projected.filterIDSet.has(2), false);
  assert.deepEqual(committedSelectionIDs([], true), []);
  assert.equal(committedSelectionIDs(undefined, true), null);
  assert.deepEqual(projectActivities(undefined, state).filterIDs, []);
});
