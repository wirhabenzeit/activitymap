import assert from 'node:assert/strict';

import test from 'node:test';

import { isStatsRoute } from './route.ts';

void test('every stats page shares the stats filter scope', () => {
  for (const path of ['/stats', '/stats/tiles', '/stats/review'])
    assert.equal(isStatsRoute(path), true, path);
  for (const path of ['/', '/list', '/map', '/statsx', '/list/stats', null])
    assert.equal(isStatsRoute(path), false, String(path));
  assert.equal(isStatsRoute(undefined), false);
});
