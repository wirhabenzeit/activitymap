import assert from 'node:assert/strict';

import test from 'node:test';
import { type StateCreator } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { createStore } from 'zustand/vanilla';

import type { CurrentUserDTO } from '~/server/db/dto';

import { useActivityPlaceFocus } from './activity-place-focus';
import { createAuthSlice } from './auth';
import { createFilterSlice } from './filter';
import type { RootState } from './index';
import { type SelectionSlice, createSelectionSlice } from './selection';

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
  assert.equal(store.getState().highlighted, 12);

  setHighlighted(11);
  assert.equal(store.getState().highlighted, 0);

  setHighlighted(12);
  setSelected([]);
  assert.deepEqual(store.getState().selected, []);
  assert.equal(store.getState().highlighted, 0);

  setSelected([11]);
  assert.equal(store.getState().highlighted, 11);

  setSelected([11, 12]);
  setSelected([12]);
  assert.equal(store.getState().highlighted, 12);
});

void test('filter changes retain hidden selection, clear focus and never reopen it', () => {
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
  const { setSelected, setHighlighted, reconcileSelection } = store.getState();
  reconcileSelection([1, 2, 3], [1, 2, 3]);
  setSelected([1, 2]);
  setHighlighted(1);
  reconcileSelection([1, 2, 3], [2, 3]);
  assert.deepEqual(store.getState().selected, [1, 2]);
  assert.equal(store.getState().highlighted, 0);
  setHighlighted(1);
  assert.equal(store.getState().highlighted, 0);
  reconcileSelection([1, 2, 3], [1, 2, 3]);
  assert.equal(store.getState().highlighted, 0);
  setSelected((previous) => [...previous, 3]);
  assert.equal(store.getState().highlighted, 0, 'Adding is not replacement');
  setSelected((previous) => previous.filter((id) => id !== 3 && id !== 1));
  assert.equal(store.getState().highlighted, 2);
  reconcileSelection([1, 3], [1, 3]);
  assert.deepEqual(store.getState().selected, []);
  assert.equal(store.getState().highlighted, 0);
});

void test('shared transition fixtures exercise production web selection', async () => {
  const { readFileSync } = await import('node:fs');
  type Snapshot = {
    selected_ids: string[];
    active_id: string | null;
    visible_ids: string[];
    combine: boolean;
    only_selected: boolean;
  };
  type Event = {
    type: string;
    ids?: string[];
    id?: string;
    geometry_available?: boolean;
    enabled?: boolean;
  };
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../shared/parity/state-fixtures.v2.json', import.meta.url),
      'utf8',
    ),
  ) as {
    known_ids: string[];
    selectionScenarios: {
      name: string;
      initial: Snapshot;
      steps: { name: string; event: Event; expected: Snapshot }[];
    }[];
  };
  for (const scenario of fixture.selectionScenarios) {
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
    let known = fixture.known_ids.map(Number);
    let visible = scenario.initial.visible_ids.map(Number);
    const { setSelected, setHighlighted, reconcileSelection } =
      store.getState();
    reconcileSelection(known, visible);
    setSelected(scenario.initial.selected_ids.map(Number));
    setHighlighted(Number(scenario.initial.active_id));
    store.getState().setCombineSelections(scenario.initial.combine);
    store.getState().setOnlySelected(scenario.initial.only_selected);
    for (const step of scenario.steps) {
      const e = step.event;
      const ids = (e.ids ?? []).map(Number),
        id = Number(e.id);
      switch (e.type) {
        case 'set_combine':
          store.getState().setCombineSelections(e.enabled!);
          break;
        case 'set_only_selected':
          store.getState().setOnlySelected(e.enabled!);
          break;
        case 'reset_scope':
          store.getState().setOnlySelected(false);
          break;
        case 'pick':
          store.getState().pickActivities(ids);
          break;
        case 'toggle_member':
          store.getState().toggleSelectedActivity(id);
          break;
        case 'dismiss_inspection':
          break;
        case 'inspect':
          break; // Independently owned by ListPage; no selection mutation.
        case 'replace_selection':
          setSelected(ids);
          break;
        case 'add_selection':
          setSelected((s) => [...new Set([...s, ...ids])]);
          break;
        case 'remove_selection':
          setSelected((s) => s.filter((x) => !ids.includes(x)));
          break;
        case 'activate':
          setHighlighted(id);
          break;
        case 'set_visible':
          visible = ids;
          reconcileSelection(known, visible);
          break;
        case 'clear_selection':
          setSelected([]);
          break;
        case 'select_all_filtered':
          setSelected((s) => [...new Set([...s, ...visible])]);
          break;
        case 'deselect_all_filtered':
          setSelected((s) => s.filter((x) => !visible.includes(x)));
          break;
        case 'toggle_selection':
          setSelected((s) =>
            s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
          );
          break;
        case 'show_on_map':
          if (e.geometry_available && visible.includes(id)) {
            store.getState().selectForMap(id);
          }
          break;
        case 'remove_activities':
          known = known.filter((x) => !ids.includes(x));
          visible = visible.filter((x) => !ids.includes(x));
          reconcileSelection(known, visible);
          break;
        case 'clear_scope':
          known = [];
          visible = [];
          store.getState().resetSelectionScope();
          break;
        default:
          throw new Error(`Unhandled event ${e.type}`);
      }
      assert.deepEqual(
        [...store.getState().selected].sort(),
        step.expected.selected_ids.map(Number).sort(),
        `${scenario.name} / ${step.name}`,
      );
      assert.equal(
        store.getState().highlighted,
        Number(step.expected.active_id),
        `${scenario.name} / ${step.name}`,
      );
      assert.equal(store.getState().combineSelections, step.expected.combine);
      assert.equal(store.getState().onlySelected, step.expected.only_selected);
    }
  }
});

void test('a partial streamed library does not delete not-yet-loaded selections', () => {
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
  store.getState().setSelected([1, 999]);
  store.getState().reconcileSelection(null, [1]);
  assert.deepEqual(store.getState().selected, [1, 999]);
  store.getState().reconcileSelection([1, 999], [1, 999]);
  assert.deepEqual(store.getState().selected, [1, 999]);
  store.getState().reconcileSelection([1], [1]);
  assert.deepEqual(store.getState().selected, [1]);
});

void test('browsing Reset clears scope, Stats Reset retains it, and account changes reset session selection', () => {
  const store = createStore<RootState>()(
    immer(
      (...args) =>
        ({
          ...createSelectionSlice(...args),
          ...createFilterSlice(...args),
          ...createAuthSlice(...args),
        }) as RootState,
    ),
  );
  const user = { id: 'one' } as CurrentUserDTO;
  store.getState().initializeAuth({ currentUser: user });
  store.getState().reconcileSelection([1, 2], [1, 2]);
  store.getState().pickActivities([1]);
  store.getState().setCombineSelections(true);
  store.getState().setOnlySelected(true);
  store.getState().resetActivityFilters();
  assert.equal(store.getState().onlySelected, true);
  store.getState().resetFilters();
  assert.equal(store.getState().onlySelected, false);
  assert.equal(store.getState().combineSelections, true);
  assert.deepEqual(store.getState().selected, [1]);
  store.getState().setOnlySelected(true);
  store.getState().initializeAuth({ currentUser: user });
  assert.equal(store.getState().onlySelected, true);
  store
    .getState()
    .initializeAuth({ currentUser: { id: 'two' } as CurrentUserDTO });
  assert.equal(store.getState().onlySelected, false);
  assert.equal(store.getState().combineSelections, false);
  assert.deepEqual(store.getState().selected, []);
});

void test('map input returns eligible hits and rejects stale rendered features', () => {
  const store = createStore<RootState>()(
    immer((...args) => ({ ...createSelectionSlice(...args) }) as RootState),
  );
  store.getState().reconcileSelection([1, 2, 3], [1, 2]);
  store.getState().pickActivities([1]);
  store.getState().setCombineSelections(true);
  assert.deepEqual(store.getState().pickActivities([3, 99]), []);
  assert.deepEqual(store.getState().selected, [1]);
  assert.equal(store.getState().highlighted, 1);
  store.getState().setOnlySelected(true);
  assert.deepEqual(store.getState().pickActivities([2]), []);
  store.getState().setOnlySelected(false);
  assert.deepEqual(store.getState().pickActivities([2, 2, 99]), [2]);
  assert.deepEqual(store.getState().selected, [1, 2]);
});

void test('map picks and explicit clearing dismiss place focus along with the activity chooser', () => {
  const store = createStore<RootState>()(
    immer((...args) => ({ ...createSelectionSlice(...args) }) as RootState),
  );
  const focus = () =>
    useActivityPlaceFocus.getState().setFocus({
      userId: 'test',
      activityId: '1',
      placeId: 'summit',
      visitIndex: 0,
      source: 'map',
    });
  store.getState().reconcileSelection([1, 2], [1, 2]);
  store.getState().setSelected([1, 2]);
  focus();
  store.getState().pickActivities([]);
  assert.deepEqual(store.getState().selected, []);
  assert.equal(useActivityPlaceFocus.getState().focus, null);

  store.getState().setSelected([1]);
  focus();
  store.getState().pickActivities([2]);
  assert.deepEqual(store.getState().selected, [2]);
  assert.equal(useActivityPlaceFocus.getState().focus, null);

  focus();
  store.getState().setCombineSelections(true);
  store.getState().pickActivities([]);
  assert.deepEqual(store.getState().selected, [2]);
  assert.equal(useActivityPlaceFocus.getState().focus?.placeId, 'summit');
  store.getState().pickActivities([1]);
  assert.equal(useActivityPlaceFocus.getState().focus, null);

  focus();
  store.getState().clearSelection();
  assert.deepEqual(store.getState().selected, []);
  assert.equal(useActivityPlaceFocus.getState().focus, null);
});
