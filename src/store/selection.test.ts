import assert from 'node:assert/strict';
import test from 'node:test';
import { type StateCreator } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { immer } from 'zustand/middleware/immer';

import { createSelectionSlice, type SelectionSlice } from './selection';

void test('the active route is always part of the selected routes', () => {
  const store = createStore<SelectionSlice>()(
    immer(
      createSelectionSlice as unknown as StateCreator<
        SelectionSlice,
        [['zustand/immer', never]],
        [],
        SelectionSlice
      >,
    ),
  );
  const { setSelected, setHighlighted } = store.getState();

  setSelected([11, 12]);
  setHighlighted(11);
  assert.equal(store.getState().highlighted, 11);

  setSelected([12]);
  assert.equal(store.getState().highlighted, 0);

  setHighlighted(11);
  assert.equal(store.getState().highlighted, 0);

  setHighlighted(12);
  setSelected([]);
  assert.deepEqual(store.getState().selected, []);
  assert.equal(store.getState().highlighted, 0);
});
