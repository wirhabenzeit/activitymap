import assert from 'node:assert/strict';
import test from 'node:test';
import { retryDeadline } from './retry-deadline';
void test('retry deadlines preserve long waits, malformed headers and server clock skew', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  assert.equal(
    retryDeadline(new Headers({ 'retry-after': '3600' }), now),
    now + 3600_000,
  );
  assert.equal(
    retryDeadline(new Headers({ 'retry-after': 'invalid' }), now),
    now + 60_000,
  );
  assert.equal(
    retryDeadline(
      new Headers({
        'retry-after': 'Mon, 05 Oct 2026 11:05:00 GMT',
        date: 'Mon, 05 Oct 2026 11:00:00 GMT',
      }),
      now,
    ),
    now + 300_000,
  );
});
