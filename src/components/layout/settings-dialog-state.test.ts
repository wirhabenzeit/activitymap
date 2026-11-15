import assert from 'node:assert/strict';

import test from 'node:test';

import {
  openSettingsDialog,
  settingsDialogState,
} from './settings-dialog-state.ts';

void test('opening and closing notify subscribers once per change', () => {
  let calls = 0;
  const unsubscribe = settingsDialogState.subscribe(() => {
    calls += 1;
  });
  assert.equal(settingsDialogState.get(), false);
  openSettingsDialog();
  openSettingsDialog();
  assert.equal(settingsDialogState.get(), true);
  assert.equal(calls, 1);
  settingsDialogState.set(false);
  assert.equal(settingsDialogState.get(), false);
  assert.equal(calls, 2);
  unsubscribe();
  openSettingsDialog();
  assert.equal(calls, 2);
  settingsDialogState.set(false);
});
