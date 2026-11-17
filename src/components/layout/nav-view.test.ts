import assert from 'node:assert/strict';

import test from 'node:test';

import { appViewForPath, navigationView } from './nav-view.ts';

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

void test('only the exact view routes are rendered by the app shell', () => {
  assert.equal(appViewForPath('/map'), 'map');
  assert.equal(appViewForPath('/list'), 'list');
  assert.equal(appViewForPath('/stats/tiles'), 'stats');
  // Real pages keep ordinary Next.js navigation.
  assert.equal(appViewForPath('/'), undefined);
  assert.equal(appViewForPath('/stats/review'), undefined);
  assert.equal(appViewForPath('/stats'), undefined);
  assert.equal(appViewForPath('/map/extra'), undefined);
  assert.equal(appViewForPath(undefined), undefined);
});
