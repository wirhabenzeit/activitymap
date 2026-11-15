import assert from 'node:assert/strict';

import test from 'node:test';

import { navigationView } from './nav-view.ts';

void test('each path marks exactly its own navigation item current', () => {
  assert.equal(navigationView('/'), 'map');
  assert.equal(navigationView('/map'), 'map');
  assert.equal(navigationView('/list'), 'list');
  assert.equal(navigationView('/stats/tiles'), 'stats');
  assert.equal(navigationView('/stats/review'), 'stats');
});

void test('unrelated routes mark no item current', () => {
  assert.equal(navigationView('/share/abc'), undefined);
  assert.equal(navigationView('/mapping'), undefined);
  assert.equal(navigationView(null), undefined);
});
