import assert from 'node:assert/strict';
import test from 'node:test';
import {
  monthActivityRhythm,
  yearMonthlyRhythm,
  periodTotal,
} from './period-rhythm';
import {
  dayFromISODate,
  monthVsLastMonth,
  yearToDate,
  type StatsActivity,
} from './tile-data';

const make = (
  date: string,
  id: number,
  sport: StatsActivity['sport'] = 'ride',
  distance: number | null = 10000,
): StatsActivity => ({
  id,
  sport,
  start_date_local: new Date(`${date}T12:00:00Z`),
  distance,
  moving_time: 3600,
  total_elevation_gain: 100,
});

void test('daily rhythm retains all calendar days, sorts activity identities and excludes future/outside activity', () => {
  const today = dayFromISODate('2026-09-22');
  const activities = [
    make('2026-09-21', 2),
    make('2026-09-21', 1, 'run'),
    make('2026-09-22', 3, 'misc', null),
    make('2026-09-23', 4),
    make('2026-08-31', 5),
  ];
  const rhythm = monthActivityRhythm(activities, today, 'distance');
  assert.equal(rhythm.days.length, 30);
  assert.equal(rhythm.activeDays, 2);
  assert.equal(rhythm.activityCount, 3);
  assert.equal(rhythm.measuredCount, 2);
  assert.equal(
    rhythm.average,
    10,
    'unknown distance is excluded from the average',
  );
  assert.deepEqual(
    rhythm.days[20]!.activities.map((activity) => activity.id),
    [1, 2],
  );
  assert.equal(rhythm.days[20]!.bySport.ride, 10);
  assert.equal(rhythm.days[20]!.bySport.run, 10);
  assert.equal(
    rhythm.days[21]!.activities.length,
    1,
    'unknown metrics still identify activity days',
  );
  assert.equal(rhythm.days[22]!.activities.length, 0);
  const count = monthActivityRhythm(activities, today, 'count');
  assert.equal(
    count.average,
    1.5,
    'count average is activities per active day',
  );
});

void test('daily rhythm handles short months, empty histories and missing metrics without invented averages', () => {
  const today = dayFromISODate('2024-02-29');
  assert.equal(monthActivityRhythm([], today, 'count').days.length, 29);
  assert.equal(
    monthActivityRhythm([], dayFromISODate('2025-02-28'), 'distance').days
      .length,
    28,
  );
  const activity = {
    ...make('2024-02-29', 1, 'run', null),
    moving_time: null,
    total_elevation_gain: null,
  };
  for (const metric of ['distance', 'time', 'elevation'] as const) {
    const rhythm = monthActivityRhythm([activity], today, metric);
    assert.equal(rhythm.average, null);
    assert.equal(rhythm.activeDays, 1);
  }
  assert.equal(monthActivityRhythm([], today, 'count').average, null);
});

void test('monthly comparison includes complete earlier months and clamps the same date across leap years', () => {
  const today = dayFromISODate('2024-02-29');
  const rows = yearMonthlyRhythm(
    [
      make('2024-01-31', 1),
      make('2024-02-29', 2, 'run', 20000),
      make('2024-03-01', 3),
      make('2023-01-31', 4),
      make('2023-02-28', 5, 'run', 30000),
      make('2023-03-01', 6),
      make('2022-02-28', 7),
    ],
    today,
    'distance',
  );
  assert.equal(rows.length, 2);
  assert.equal(periodTotal(rows[0]!.current), 10);
  assert.equal(periodTotal(rows[0]!.previous), 10);
  assert.equal(rows[0]!.inProgress, false);
  assert.equal(rows[1]!.current.run, 20);
  assert.equal(rows[1]!.previous.run, 30);
  assert.equal(rows[1]!.inProgress, true);
  const nonLeap = yearMonthlyRhythm(
    [make('2024-02-28', 1), make('2024-02-29', 2)],
    dayFromISODate('2025-02-28'),
    'distance',
  );
  assert.equal(
    periodTotal(nonLeap[1]!.previous),
    10,
    'February 29 is after the comparable date',
  );
});

void test('daily and monthly visuals reconcile with existing period headlines across every metric', () => {
  const today = dayFromISODate('2026-09-22');
  const activities = [
    make('2026-01-31', 1),
    make('2026-09-21', 2, 'run'),
    make('2026-09-23', 3),
    make('2025-01-31', 4),
    make('2025-09-22', 5, 'misc'),
    make('2025-09-23', 6),
  ];
  for (const metric of ['distance', 'time', 'elevation', 'count'] as const) {
    const days = monthActivityRhythm(activities, today, metric).days;
    assert.equal(
      days.reduce((sum, day) => sum + periodTotal(day.bySport), 0),
      monthVsLastMonth(activities, today, metric).current,
    );
    const months = yearMonthlyRhythm(activities, today, metric);
    const headline = yearToDate(activities, today, metric);
    assert.equal(
      months.reduce((sum, month) => sum + periodTotal(month.current), 0),
      headline.current,
    );
    assert.equal(
      months.reduce((sum, month) => sum + periodTotal(month.previous), 0),
      headline.previous,
    );
  }
});
