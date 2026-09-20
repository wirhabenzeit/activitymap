import assert from 'node:assert/strict';
import test from 'node:test';

import { maxDuration } from './route.ts';

void test('summary reconciliation has enough time for one checkpointed page', () => {
  assert.equal(maxDuration, 60);
});
