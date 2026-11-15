import assert from 'node:assert/strict';

import test from 'node:test';

import { formatPreferredMonth } from './month-label.ts';

void test('month labels follow the date-format preference', () => {
  const march = new Date(2026, 2, 1);
  assert.equal(formatPreferredMonth(march, 'system', 'en'), 'Mar 2026');
  assert.equal(formatPreferredMonth(march, 'day-first'), '03.2026');
  assert.equal(formatPreferredMonth(march, 'month-first'), '03/2026');
  assert.equal(formatPreferredMonth(march, 'iso'), '2026-03');
});
