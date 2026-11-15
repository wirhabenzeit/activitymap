import assert from 'node:assert/strict';

import test from 'node:test';

import {
  DATE_PRESETS,
  activeDatePreset,
  datePresetRange,
  formatDateRangeLabel,
  parseDayRangeInput,
  todayCalendarDate,
} from './date-range.ts';

void test('presets use the native names in sentence case', () => {
  assert.deepEqual(
    DATE_PRESETS.map((preset) => preset.label),
    ['This year', 'Last year', 'This month', 'Last month', 'Last 12 months'],
  );
});

void test('calendar presets cover whole periods including future days', () => {
  const today = '2026-03-15';
  assert.deepEqual(datePresetRange('this-year', today), {
    start: '2026-01-01',
    end: '2026-12-31',
  });
  assert.deepEqual(datePresetRange('last-year', today), {
    start: '2025-01-01',
    end: '2025-12-31',
  });
  assert.deepEqual(datePresetRange('this-month', today), {
    start: '2026-03-01',
    end: '2026-03-31',
  });
  assert.deepEqual(datePresetRange('last-month', today), {
    start: '2026-02-01',
    end: '2026-02-28',
  });
});

void test('month presets handle year boundaries and leap years', () => {
  assert.deepEqual(datePresetRange('last-month', '2026-01-09'), {
    start: '2025-12-01',
    end: '2025-12-31',
  });
  assert.deepEqual(datePresetRange('this-month', '2028-02-10'), {
    start: '2028-02-01',
    end: '2028-02-29',
  });
});

void test('last 12 months runs from the same day a year ago through today', () => {
  assert.deepEqual(datePresetRange('last-12-months', '2026-03-15'), {
    start: '2025-03-15',
    end: '2026-03-15',
  });
  // 29 February has no counterpart a year earlier.
  assert.deepEqual(datePresetRange('last-12-months', '2028-02-29'), {
    start: '2027-02-28',
    end: '2028-02-29',
  });
});

void test('today is the viewer calendar day, not a UTC day', () => {
  assert.equal(todayCalendarDate(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
  assert.equal(todayCalendarDate(new Date(2026, 0, 1, 0, 1)), '2026-01-01');
});

void test('the active preset is recognised only for an exact match', () => {
  const today = '2026-03-15';
  assert.equal(
    activeDatePreset(datePresetRange('last-12-months', today), today),
    'last-12-months',
  );
  assert.equal(
    activeDatePreset({ start: '2026-01-01', end: '2026-12-30' }, today),
    undefined,
  );
  assert.equal(activeDatePreset(undefined, today), undefined);
});

void test('day inputs accept an inclusive range and reject reversed or partial ones', () => {
  assert.deepEqual(parseDayRangeInput('2026-03-05', '2026-03-05'), {
    status: 'valid',
    range: { start: '2026-03-05', end: '2026-03-05' },
  });
  assert.deepEqual(parseDayRangeInput('', ''), { status: 'empty' });
  assert.deepEqual(parseDayRangeInput('2026-03-06', '2026-03-05'), {
    status: 'invalid',
  });
  assert.deepEqual(parseDayRangeInput('2026-03-05', ''), { status: 'invalid' });
  assert.deepEqual(parseDayRangeInput('2026-02-30', '2026-03-05'), {
    status: 'invalid',
  });
});

void test('whole-month ranges read as months', () => {
  assert.equal(
    formatDateRangeLabel(
      { start: '2025-03-01', end: '2025-06-30' },
      'system',
      'en',
    ),
    'Mar 2025 – Jun 2025',
  );
  assert.equal(
    formatDateRangeLabel(
      { start: '2025-03-01', end: '2025-03-31' },
      'system',
      'en',
    ),
    'Mar 2025',
  );
  assert.equal(
    formatDateRangeLabel({ start: '2025-03-01', end: '2025-06-30' }, 'iso'),
    '2025-03 – 2025-06',
  );
});

void test('day-level ranges follow the date-format preference', () => {
  const range = { start: '2025-03-05', end: '2025-06-20' };
  assert.equal(
    formatDateRangeLabel(range, 'system', 'en'),
    'Mar 5, 2025 – Jun 20, 2025',
  );
  assert.equal(
    formatDateRangeLabel(range, 'day-first'),
    '05.03.2025 – 20.06.2025',
  );
  assert.equal(
    formatDateRangeLabel(range, 'month-first'),
    '03/05/2025 – 06/20/2025',
  );
  assert.equal(formatDateRangeLabel(range, 'iso'), '2025-03-05 – 2025-06-20');
  assert.equal(
    formatDateRangeLabel({ start: '2025-03-05', end: '2025-03-05' }, 'iso'),
    '2025-03-05',
  );
});

void test('a range that only ends on a month boundary stays day-level', () => {
  assert.equal(
    formatDateRangeLabel({ start: '2025-03-02', end: '2025-03-31' }, 'iso'),
    '2025-03-02 – 2025-03-31',
  );
});
