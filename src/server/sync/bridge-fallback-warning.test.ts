import assert from 'node:assert/strict';

import test from 'node:test';

import { createBridgeFallbackWarning } from './bridge-fallback-warning';

void test('fallback warnings are bounded independently and summarize suppressed calls', () => {
  let now = 0;
  const warnings: unknown[][] = [];
  const report = createBridgeFallbackWarning(
    (...args) => {
      warnings.push(args);
    },
    () => now,
  );
  for (let i = 0; i < 100; i++) {
    report('rateLimits');
    report('changesPage');
  }
  assert.deepEqual(warnings, [
    [
      '[Convex] using compatibility fallback',
      { operation: 'rateLimits', status: 400, suppressed: 0 },
    ],
    [
      '[Convex] using compatibility fallback',
      { operation: 'changesPage', status: 400, suppressed: 0 },
    ],
  ]);
  now = 59_999;
  report('changesPage');
  assert.equal(warnings.length, 2);
  now = 60_000;
  report('rateLimits');
  report('changesPage');
  assert.deepEqual(
    warnings.slice(2).map((args) => args[1]),
    [
      { operation: 'rateLimits', status: 400, suppressed: 99 },
      { operation: 'changesPage', status: 400, suppressed: 100 },
    ],
  );
});
