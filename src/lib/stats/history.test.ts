import assert from 'node:assert/strict';
import test from 'node:test';
import { dayFromISODate, isoDate, type StatsActivity } from './tile-data';
import { volumeHistory, calendarDays } from './history';
import { calendarMonths } from './tile-series';

const activity = (
  date: string,
  sport: StatsActivity['sport'] = 'ride',
  hours = 1,
  id = 1,
): StatsActivity => ({
  id,
  name: `Activity ${id}`,
  sport,
  start_date_local: new Date(`${date}T12:00:00Z`),
  distance: 10000,
  moving_time: hours * 3600,
  total_elevation_gain: 100,
});
const today = dayFromISODate('2026-09-27');

void test('weekly history uses Monday boundaries and consecutive pages without overlap', () => {
  const current = volumeHistory([], today, 'count', 'weeks');
  const previous = volumeHistory([], today, 'count', 'weeks', 1);
  assert.equal(current.length, 12);
  assert.equal(isoDate(current[0]!.start), '2026-07-06');
  assert.equal(previous.at(-1)!.end + 1, current[0]!.start);
  const edge = isoDate(current[0]!.start);
  assert.equal(
    volumeHistory([activity(edge)], today, 'count', 'weeks')[0]!.total,
    1,
  );
  assert.equal(
    volumeHistory([activity(edge)], today, 'count', 'weeks', 1).reduce(
      (sum, b) => sum + b.total,
      0,
    ),
    0,
  );
});

void test('monthly history includes leap day and preserves metric and sport totals', () => {
  const end = dayFromISODate('2024-03-01');
  const rows = volumeHistory(
    [
      activity('2024-02-29', 'ride', 2),
      activity('2024-02-29', 'run'),
      activity('2024-03-02'),
    ],
    end,
    'time',
    'months',
  );
  const feb = rows.find((row) => isoDate(row.start) === '2024-02-01')!;
  assert.equal(isoDate(feb.end), '2024-02-29');
  assert.equal(feb.total, 3);
  assert.equal(feb.bySport.ride, 2);
  assert.equal(feb.bySport.run, 1);
  assert.equal(rows.at(-1)!.total, 0, 'future activities excluded');
  assert.equal(
    volumeHistory([], end, 'count', 'months', 1).at(-1)!.end + 1,
    rows[0]!.start,
  );
});

void test('all years retains empty years and clips the current year to today', () => {
  const rows = volumeHistory(
    [activity('2022-01-01'), activity('2024-12-31'), activity('2027-01-01')],
    today,
    'distance',
    'years',
  );
  assert.deepEqual(
    rows.map((row) => row.total),
    [10, 0, 10, 0, 0],
  );
  assert.equal(rows.at(-1)!.end, today);
  assert.equal(volumeHistory([], today, 'count', 'years').length, 1);
});

void test('calendar day details retain every activity and distinguish mixed sport groups', () => {
  const first = dayFromISODate('2024-01-01');
  const last = dayFromISODate('2024-12-31');
  const sample = [
    activity('2024-02-29', 'ride', 2, 10),
    activity('2024-02-29', 'run', 1, 11),
    activity('2023-12-31', 'run', 1, 12),
  ];
  const { days, mixedDays, dominantSport } = calendarDays(sample, first, last);
  const leapDay = dayFromISODate('2024-02-29');
  assert.deepEqual(
    days.get(leapDay)!.map((a) => a.id),
    [10, 11],
  );
  assert.equal(days.size, 1);
  assert.equal(dominantSport.get(leapDay), 'ride');
  assert.equal(mixedDays.has(leapDay), true);
  assert.equal(
    calendarDays(
      sample.filter((a) => a.sport === 'ride'),
      first,
      last,
    ).mixedDays.size,
    0,
  );
  const months = calendarMonths(last, first);
  assert.equal(months.length, 12);
  assert.equal(
    months.reduce((sum, month) => sum + month.last - month.first + 1, 0),
    366,
  );
});
