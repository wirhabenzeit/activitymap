import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeShareLinkFieldOptions } from './fields';

void test('reads current share options as stored', () => {
  assert.deepEqual(normalizeShareLinkFieldOptions({ showRouteEnds: true }), { showRouteEnds: true });
  assert.deepEqual(normalizeShareLinkFieldOptions({ showRouteEnds: false }), { showRouteEnds: false });
});

void test('maps links created before shares were narrowed to tracks', () => {
  assert.deepEqual(
    normalizeShareLinkFieldOptions({ heartRate: true, power: true, social: true, preciseLocation: false }),
    { showRouteEnds: false },
  );
  assert.deepEqual(
    normalizeShareLinkFieldOptions({ heartRate: false, power: false, social: false, preciseLocation: true }),
    { showRouteEnds: true },
  );
});
