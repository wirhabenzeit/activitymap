import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonBand } from './comparison-band';
import { dayFromISODate, type StatsActivity } from './tile-data';
import { cumulativeYearPoints, yearStart } from './tile-series';

const activity = (date: string, km: number): StatsActivity => ({
  start_date_local: new Date(`${date}T12:00:00Z`),
  sport: 'run',
  distance: km * 1000,
  moving_time: km * 3600,
  total_elevation_gain: km,
});

void test('monthly percentiles suppress one extreme without changing the previous-period baseline', () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    activity(
      `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
      i * 10,
    ),
  );
  rows.push(activity('2025-09-01', 100000));
  const band = comparisonBand(
    rows,
    dayFromISODate('2025-09-15'),
    'distance',
    'month',
  )!;
  assert.equal(band.count, 20);
  assert.deepEqual(
    band.points.find((p) => p.x === 1),
    { x: 1, low: 9.5, high: 180.5, count: 20 },
  );
  assert.equal(band.last, dayFromISODate('2025-08-31'));
});

void test('empty recorded months count, shorter months forward-fill and opening partial history is excluded', () => {
  const rows = [activity('2024-01-01', 10), activity('2024-03-01', 30)];
  const today = dayFromISODate('2024-04-15');
  const band = comparisonBand(rows, today, 'distance', 'month')!;
  assert.deepEqual(
    band.points.find((p) => p.x === 1),
    { x: 1, low: 1, high: 28, count: 3 },
  );
  assert.deepEqual(
    band.points.find((p) => p.x === 31),
    { x: 31, low: 1, high: 28, count: 3 },
  );
  rows[0] = activity('2024-01-15', 10);
  assert.equal(
    comparisonBand(rows, today, 'distance', 'month')!.first,
    dayFromISODate('2024-02-01'),
  );
});

void test('a high short month stays in the percentile band through day 31', () => {
  for (const year of [2023, 2024]) {
    const band = comparisonBand(
      [
        activity(`${year}-01-01`, 10),
        activity(`${year}-02-28`, 100),
        activity(`${year}-03-30`, 20),
      ],
      dayFromISODate(`${year}-04-15`),
      'distance',
      'month',
    )!;
    for (const point of band.points) {
      assert.equal(point.count, 3);
      const previous = band.points.find((p) => p.x === point.x - 1);
      if (previous) {
        assert.ok(point.low >= previous.low);
        assert.ok(point.high >= previous.high);
      }
    }
    assert.deepEqual(band.points.at(-1), {
      x: 31,
      low: 11,
      high: 92,
      count: 3,
    });
  }
});

void test('years use min/max, calendar alignment and completed years only', () => {
  const rows = [
    activity('2023-01-01', 10),
    activity('2023-02-28', 5),
    activity('2023-03-01', 100),
    activity('2024-01-01', 20),
    activity('2025-01-01', 100000),
  ];
  const band = comparisonBand(
    rows,
    dayFromISODate('2025-06-01'),
    'distance',
    'year',
  )!;
  assert.equal(band.count, 2);
  assert.deepEqual(band.points[0], { x: 0, low: 10, high: 20, count: 2 });
  assert.deepEqual(band.points[59], { x: 59, low: 15, high: 20, count: 2 });
  assert.deepEqual(band.points[60], { x: 60, low: 20, high: 115, count: 2 });
  // The previous year may be the lower or upper boundary, but must remain inside.
  for (const point of cumulativeYearPoints(
    rows,
    'distance',
    2024,
    yearStart(2025) - 1,
  )) {
    const range = band.points[point.x]!;
    assert.ok(point.y >= range.low && point.y <= range.high);
  }
  assert.equal(
    comparisonBand(rows, dayFromISODate('2024-06-01'), 'distance', 'year'),
    undefined,
  );
  assert.equal(
    comparisonBand([], dayFromISODate('2025-06-01'), 'count', 'month'),
    undefined,
  );
});
