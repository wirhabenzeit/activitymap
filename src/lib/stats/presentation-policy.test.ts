import assert from 'node:assert/strict';

import test from 'node:test';

import fixture from '../../../shared/stats-presentation-fixtures.v1.json';
import {
  type DayGridLayout,
  dayGridTarget,
  selectedMonthDay,
} from './day-grid';
import {
  comparisonPercentage,
  comparisonPeriods,
  comparisonPresentation,
} from './presentation-policy';
import { periodComparison } from './tile-data';

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
for (const row of fixture.percentages)
  void test(`symmetric comparison: ${row.current}/${row.previous}`, () => {
    assert.deepEqual(comparisonPresentation(row.current, row.previous), {
      direction: row.direction,
      magnitude: row.magnitude,
      lessThanOne: row.lessThanOne,
    });
    assert.equal(comparisonPercentage(row.current, row.previous), row.text);
  });
for (const row of fixture.periods)
  void test(`period facts: ${row.today}/${row.kind}`, () => {
    const kind = row.kind as 'month' | 'year';
    const periods = comparisonPeriods(day(row.today), kind);
    assert.deepEqual(
      periodComparison([], day(row.today), 'distance', kind).periods,
      periods,
    );
    assert.deepEqual(periods, {
      current: { first: day(row.first), last: day(row.today), complete: false },
      previous: {
        first: day(row.previousFirst),
        last: day(row.previousLast),
        complete: row.previousComplete,
      },
    });
  });
for (const row of fixture.navigation)
  void test(`grid focus: ${row.layout}/${row.key}/${row.rtl}`, () => {
    assert.equal(
      dayGridTarget(
        row.day,
        row.key,
        row.first,
        row.last,
        row.layout as DayGridLayout,
        row.rtl,
      ),
      row.expected,
    );
  });
void test('month starts with latest active day, preserves explicit empty days, and fences stale selections', () => {
  assert.equal(selectedMonthDay(null, [2, 8, 12], 1, 10), 8);
  assert.equal(selectedMonthDay(4, [2, 8], 1, 10), 4);
  assert.equal(selectedMonthDay(20, [2, 8], 1, 10), 8);
  assert.equal(selectedMonthDay(null, [], 1, 10), null);
});
void test('invalid or zero baselines cannot produce NaN/Infinity and signed zero has no sign', () => {
  assert.equal(comparisonPercentage(0, -0), null);
  assert.equal(comparisonPercentage(Infinity, 1), null);
  assert.equal(comparisonPercentage(-0, 10), '−100%');
});
