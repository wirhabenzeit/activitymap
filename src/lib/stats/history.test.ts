import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dayFromISODate,
  isoDate,
  fourWeekVolume,
  type StatsActivity,
} from './tile-data';
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

void test('rolling volume averages use offscreen history and exclude the incomplete period', async () => {
  const { volumeHistoryAverage } = await import('./history');
  const cases = [
    {
      range: 'weeks' as const,
      dates: [
        '2026-06-15',
        '2026-06-22',
        '2026-06-29',
        '2026-07-06',
        '2026-08-24',
        '2026-08-31',
        '2026-09-07',
        '2026-09-14',
        '2026-09-21',
      ],
      first: '2026-07-06',
      last: 6.5,
    },
    {
      range: 'months' as const,
      dates: [
        '2025-07-01',
        '2025-08-01',
        '2025-09-01',
        '2025-10-01',
        '2026-05-01',
        '2026-06-01',
        '2026-07-01',
        '2026-08-01',
        '2026-09-01',
      ],
      first: '2025-10-01',
      last: 6.5,
    },
    {
      range: 'years' as const,
      dates: [
        '2019-01-01',
        '2020-01-01',
        '2021-01-01',
        '2022-01-01',
        '2023-01-01',
        '2024-01-01',
        '2025-01-01',
        '2026-01-01',
      ],
      first: '2022-01-01',
      last: 5.5,
    },
  ];
  for (const example of cases) {
    const rows = example.dates.map((date, index) =>
      activity(
        date,
        'ride',
        index === example.dates.length - 1 ? 100 : index + 1,
      ),
    );
    const trend = volumeHistoryAverage(rows, today, 'time', example.range);
    assert.equal(isoDate(Number(trend[0]!.x)), example.first);
    assert.equal(trend[0]!.value, 2.5);
    assert.equal(trend.at(-1)!.value, example.last);
  }
  assert.deepEqual(volumeHistoryAverage([], today, 'time', 'weeks'), []);
  assert.deepEqual(
    volumeHistoryAverage([activity('2026-09-21')], today, 'time', 'weeks'),
    [],
  );
});

void test('current history periods remain incomplete through their final day and complete on rollover', () => {
  const rows = [activity('2020-01-01')];
  for (const [date, range] of [
    ['2026-10-04', 'weeks'],
    ['2026-09-30', 'months'],
    ['2024-02-29', 'months'],
    ['2026-12-31', 'years'],
  ] as const) {
    const end = dayFromISODate(date);
    const current = volumeHistory(rows, end, 'distance', range).at(-1)!;
    assert.equal(current.incomplete, true, `${range} on ${date}`);
    const next = volumeHistory(rows, end + 1, 'distance', range);
    assert.equal(
      next.find((bucket) => bucket.start === current.start)!.incomplete,
      false,
    );
    assert.equal(next.at(-1)!.incomplete, true);
  }
  assert.equal(
    volumeHistory([activity('2020-10-15')], today, 'distance', 'years')[0]!
      .incomplete,
    true,
  );
});

void test('volume headline rolls two adjacent 28-day windows including today on every weekday', () => {
  for (let weekday = 0; weekday < 7; weekday++) {
    const day = dayFromISODate('2026-09-28') + weekday;
    const rows = [0, 27, 28, 55, 56, -1].map((offset, id) =>
      activity(isoDate(day - offset), 'ride', 1, id),
    );
    assert.deepEqual(fourWeekVolume(rows, day, 'distance'), {
      current: 20,
      previous: 20,
    });
    assert.deepEqual(
      fourWeekVolume(
        [...rows, activity(isoDate(day), 'ride', 1, 10)],
        day,
        'distance',
      ),
      { current: 30, previous: 20 },
    );
  }
});
