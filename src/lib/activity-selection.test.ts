import assert from 'node:assert/strict';
import test from 'node:test';
import fixtures from '../../shared/parity/state-fixtures.v2.json';
import {
  emptySelection,
  selectionTransition,
  browsingIDs,
  type ActivitySelection,
  type SelectionEvent,
} from './activity-selection';

type Snapshot = (typeof fixtures.selectionScenarios)[number]['initial'];
function model(s: Snapshot): ActivitySelection {
  return {
    ...emptySelection(),
    selectedIDs: s.selected_ids.map(Number),
    activeID: Number(s.active_id) || null,
    inspectedID: Number(s.inspected_id) || null,
    eligibleIDs: s.visible_ids.map(Number),
    knownIDs: fixtures.known_ids.map(Number),
    combine: s.combine,
    onlySelected: s.only_selected,
  };
}
for (const scenario of fixtures.selectionScenarios)
  void test(`shared v2: ${scenario.name}`, () => {
    let state = model(scenario.initial);
    for (const step of scenario.steps) {
      const e = step.event as {
        type: string;
        id?: string;
        ids?: string[];
        enabled?: boolean;
        geometry_available?: boolean;
      };
      const id = Number(e.id),
        ids = (e.ids ?? []).map(Number);
      let event: SelectionEvent;
      switch (e.type) {
        case 'replace_selection':
          event = { type: 'replace', ids };
          break;
        case 'add_selection':
          event = { type: 'add', ids };
          break;
        case 'remove_selection':
          event = { type: 'remove', ids };
          break;
        case 'toggle_selection':
          event = {
            type: state.selectedIDs.includes(id) ? 'remove' : 'add',
            ids: [id],
          };
          break;
        case 'toggle_member':
          event = { type: 'toggle', id };
          break;
        case 'set_combine':
        case 'set_only_selected':
          event = { type: e.type, enabled: e.enabled! };
          break;
        case 'pick':
          event = { type: 'pick', ids };
          break;
        case 'select_all_filtered':
          event = { type: 'add', ids: state.eligibleIDs! };
          break;
        case 'deselect_all_filtered':
          event = { type: 'remove', ids: state.eligibleIDs! };
          break;
        case 'clear_selection':
          event = { type: 'clear' };
          break;
        case 'set_visible':
          event = {
            type: 'reconcile',
            knownIDs: state.knownIDs,
            eligibleIDs: ids,
          };
          break;
        case 'remove_activities':
          event = {
            type: 'reconcile',
            knownIDs: state.knownIDs!.filter((n) => !ids.includes(n)),
            eligibleIDs: state.eligibleIDs!.filter((n) => !ids.includes(n)),
          };
          break;
        case 'activate':
        case 'inspect':
          event = { type: e.type, id };
          break;
        case 'dismiss_inspection':
        case 'clear_scope':
        case 'reset_scope':
          event = { type: e.type };
          break;
        case 'show_on_map':
          event = {
            type: 'show_on_map',
            id,
            hasGeometry: e.geometry_available ?? true,
          };
          break;
        default:
          throw new Error(e.type);
      }
      state = selectionTransition(state, event);
      const expected = step.expected;
      const label = `${scenario.name} / ${step.name}`;
      assert.deepEqual(
        [...state.selectedIDs].sort(),
        expected.selected_ids.map(Number).sort(),
        label,
      );
      assert.equal(state.activeID, Number(expected.active_id) || null, label);
      assert.equal(
        state.inspectedID,
        Number(expected.inspected_id) || null,
        label,
      );
      assert.equal(state.combine, expected.combine, label);
      assert.equal(state.onlySelected, expected.only_selected, label);
      assert.deepEqual(
        [...browsingIDs(state, state.eligibleIDs ?? [])].sort(),
        expected.displayed_ids.map(Number).sort(),
        label,
      );
    }
  });
