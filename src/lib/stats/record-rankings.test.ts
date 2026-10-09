import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dayFromISODate,
  isoDate,
  recordRankings,
  records,
  type StatsActivity,
} from './tile-data';

const activity = (id: number, date: string, km: number): StatsActivity => ({
  id,
  name: `Ride ${id}`,
  sport: 'ride',
  start_date_local: new Date(`${date}T12:00:00Z`),
  distance: km * 1000,
  moving_time: null,
  total_elevation_gain: 0,
});

void test('podiums retain the top three identities with chronological and stable-ID ties', () => {
  const rows = [
    activity(9, '2026-01-02', 10),
    activity(8, '2026-01-02', 10),
    activity(2, '2026-01-02', 10),
    activity(20, '2026-01-01', 10),
  ];
  const today = dayFromISODate('2026-01-15');
  const ranked = recordRankings(rows, today, 'currentYear');
  assert.deepEqual(
    ranked.distance.map((row) => row.activityId),
    [20, 2, 8],
  );
  assert.deepEqual(
    ranked.distance,
    recordRankings([...rows].reverse(), today, 'currentYear').distance,
  );
  assert.deepEqual(
    ranked.distance[0],
    records(rows, today, 'currentYear').distance,
  );
  assert.deepEqual(ranked.time, []);
  assert.deepEqual(ranked.elevation, []);
});

void test('podiums clip the current year and exclude future activities from activity and week rankings', () => {
  const rows = [
    activity(1, '2025-12-31', 100),
    activity(2, '2026-01-01', 10),
    activity(3, '2026-01-02', 20),
    activity(4, '2026-01-05', 20),
    activity(5, '2026-01-12', 30),
    activity(6, '2026-01-16', 1000),
  ];
  const today = dayFromISODate('2026-01-15');
  const year = recordRankings(rows, today, 'currentYear');
  assert.deepEqual(
    year.distance.map((row) => row.activityId),
    [5, 3, 4],
  );
  assert.deepEqual(
    year.biggestWeek.map((row) => [isoDate(row.weekStart), row.value]),
    [
      ['2025-12-29', 30],
      ['2026-01-12', 30],
      ['2026-01-05', 20],
    ],
  );
  const allTime = recordRankings(rows, today, 'allTime');
  assert.deepEqual(
    allTime.distance.map((row) => row.activityId),
    [1, 5, 3],
  );
  assert.equal(allTime.biggestWeek[0]!.value, 130);
  assert.deepEqual(recordRankings([], today, 'allTime'), {
    distance: [],
    time: [],
    elevation: [],
    biggestWeek: [],
  });
});
