import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consistency,
  dayFromISODate,
  isoDate,
  type StatsActivity,
} from './tile-data';
import {
  calendarMonths,
  calendarWeeks,
  calendarSummaryWindow,
  comparisonYear,
  cumulativeYearPoints,
  volumeDomain,
  yearStart,
  weeklyActiveDays,
} from './tile-series';

const activity = (date: string): StatsActivity => ({
  sport: 'run',
  start_date_local: new Date(`${date}T12:00:00Z`),
  distance: 10000,
  moving_time: 3600,
  total_elevation_gain: 100,
});

void test('weekly active days count unique days, include empty weeks and exclude future activities', () => {
  const today = dayFromISODate('2026-01-01');
  const activities = [
    '2025-12-22',
    '2025-12-22',
    '2025-12-28',
    '2025-12-29',
    '2026-01-01',
    '2026-01-02',
    '2024-01-01',
  ].map(activity);
  for (const weeks of [12, 52] as const) {
    const rows = weeklyActiveDays(activities, today, weeks);
    assert.equal(rows.length, weeks);
    assert.deepEqual(rows.at(-1), {
      start: dayFromISODate('2025-12-29'),
      activeDays: 2,
      partial: true,
    });
    assert.deepEqual(rows.at(-2), {
      start: dayFromISODate('2025-12-22'),
      activeDays: 2,
      partial: false,
    });
    assert.ok(rows.slice(0, -2).every((row) => row.activeDays === 0));
    assert.equal(rows.filter((row) => row.partial).length, 1);
    assert.equal(
      rows.slice(0, -1).reduce((sum, row) => sum + row.activeDays, 0) /
        (weeks - 1),
      consistency(activities, today, weeks).activeDaysPerWeek,
    );
  }
});

void test('weekly active days include the first Monday and cap a full week at seven days', () => {
  const today = dayFromISODate('2026-09-28');
  const first = today - 11 * 7;
  const activities = Array.from({ length: 9 }, (_, i) =>
    activity(isoDate(first + i - 1)),
  );
  const rows = weeklyActiveDays([...activities, ...activities], today, 12);
  assert.equal(rows[0]!.activeDays, 7);
  assert.equal(rows[1]!.activeDays, 1);
  assert.equal(rows.at(-1)!.activeDays, 0);
  assert.equal(rows.at(-1)!.partial, true);
});

void test('year curves align month/day across leap years and keep February 29 distinct', () => {
  const rows = [2024, 2025].map((year) =>
    cumulativeYearPoints(
      [activity(`${year}-03-01`)],
      'distance',
      year,
      dayFromISODate(`${year}-12-31`),
    ),
  );
  const march = rows.map((points) => points.find((point) => point.y > 0)!);
  assert.equal(march[0]!.x, march[1]!.x);
  assert.equal(isoDate(yearStart(comparisonYear) + march[0]!.x), '2000-03-01');
  assert.equal(rows[0]!.at(-1)!.x, rows[1]!.at(-1)!.x);
  assert.equal(rows[0]!.length, 366);
  assert.equal(rows[1]!.length, 365);
  const leap = cumulativeYearPoints(
    [activity('2024-02-29')],
    'distance',
    2024,
    dayFromISODate('2024-03-01'),
  ).find((point) => point.y > 0)!;
  assert.equal(isoDate(yearStart(comparisonYear) + leap.x), '2000-02-29');
  assert.ok(!rows[1]!.some((point) => point.x === leap.x));
});

void test('calendar cells cover precisely the inclusive rolling year, including its partial first month', () => {
  for (const [today, first] of [
    ['2026-09-01', '2025-09-01'],
    ['2024-02-29', '2023-02-28'],
    ['2026-12-31', '2025-12-31'],
  ]) {
    const months = calendarMonths(dayFromISODate(today!));
    const cells = months.flatMap((month) =>
      Array.from(
        { length: month.last - month.first + 1 },
        (_, i) => month.first + i,
      ),
    );
    assert.equal(isoDate(cells[0]!), first);
    assert.equal(isoDate(cells.at(-1)!), today);
    assert.equal(new Set(cells).size, cells.length);
    assert.equal(
      cells.length,
      dayFromISODate(today!) - dayFromISODate(first!) + 1,
    );
  }
});

void test('volume scale includes unusually large and small partial weeks and constant histories', () => {
  for (const values of [
    [100, 105, 500],
    [100, 105, 0],
    [100, 100, 100],
    [0, 0],
  ]) {
    const [low, high] = volumeDomain(values);
    assert.ok(low < high);
    for (const value of values) assert.ok(value >= low && value <= high);
  }
  assert.deepEqual(volumeDomain([]), [0, 1]);
});

void test('weekday calendar aligns Mondays and preserves partial weeks, empty days and leap days across years', () => {
  for (const [start, end] of [
    ['2024-02-28', '2024-03-05'],
    ['2025-12-31', '2026-01-05'],
    ['2026-10-18', '2026-10-18'],
    ['2020-01-01', '2026-10-18'],
  ]) {
    const first = dayFromISODate(start!);
    const last = dayFromISODate(end!);
    const weeks = calendarWeeks(last, first);
    const days = weeks
      .flatMap((week) => week.days)
      .filter((day) => day !== null);
    assert.deepEqual(
      days,
      Array.from({ length: last - first + 1 }, (_, i) => first + i),
    );
    for (const week of weeks) {
      assert.equal(new Date(week.start * 86400000).getUTCDay(), 1);
      assert.equal(week.days.length, 7);
      week.days.forEach((day, row) => {
        if (day !== null)
          assert.equal(new Date(day * 86400000).getUTCDay(), (row + 1) % 7);
      });
    }
  }
  assert.deepEqual(calendarWeeks(0, 1), []);
});

void test('compact calendar fits recent weeks to the tile dimensions and keeps the current week', () => {
  const today = dayFromISODate('2026-10-18');
  const narrow = calendarSummaryWindow(today, 320, 300);
  const wide = calendarSummaryWindow(today, 560, 300);
  assert.equal(narrow.weeks, 14);
  assert.equal(wide.weeks, 26);
  assert(wide.first < narrow.first);
  for (const [width, height] of [
    [160, 250],
    [320, 300],
    [560, 300],
    [1600, 400],
  ]) {
    const window = calendarSummaryWindow(today, width!, height!);
    assert(window.weeks >= 4 && window.weeks <= 52);
    const weeks = calendarWeeks(today, window.first);
    assert.equal(weeks.length, window.weeks);
    assert.equal(weeks[0]!.days[0], window.first);
    assert.equal(weeks.at(-1)!.days.at(-1), today);
    assert((width! - 40 - (window.weeks - 1) * 2) / window.weeks >= 14);
  }
  // A shorter tile fits smaller squares and can show more week columns.
  assert(
    calendarSummaryWindow(today, 480, 250).weeks >
      calendarSummaryWindow(today, 480, 400).weeks,
  );
});
