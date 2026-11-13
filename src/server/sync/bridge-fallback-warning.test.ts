import assert from 'node:assert/strict';

import test from 'node:test';

import { createBridgeFallbackWarning } from './bridge-fallback-warning';

void test('rate-limit fallback warnings are bounded and summarize suppressed calls', () => {
  let now = 0;
  const warnings: unknown[][] = [];
  const report = createBridgeFallbackWarning(
    (...args) => warnings.push(args),
    () => now,
  );
  for (let i = 0; i < 100; i++) report('rateLimits');
  assert.deepEqual(warnings, [
    [
      '[Convex] using compatibility fallback',
      { operation: 'rateLimits', status: 400, suppressed: 0 },
    ],
  ]);
  now = 59_999;
  report('rateLimits');
  assert.equal(warnings.length, 1);
  now = 60_000;
  report('rateLimits');
  assert.deepEqual(warnings[1]?.[1], {
    operation: 'rateLimits',
    status: 400,
    suppressed: 100,
  });
});
