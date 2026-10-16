import assert from 'node:assert/strict';
import test from 'node:test';
import fixture from '../../shared/parity/speed-display.v1.json';
import {
  formatSpeed,
  speedDisplayForSport,
  speedDisplayForSports,
} from './speed-display';
import { sortActivities } from './activity-presentation';
import { activityDetailStats } from './activity-detail-stats';

void test('shared web/native sport, units, rounding and missing-value fixtures', () => {
  for (const row of fixture.formatCases) {
    for (const units of ['metric', 'imperial'] as const) {
      assert.equal(
        formatSpeed(row.speed, speedDisplayForSport(row.sport), units),
        row[units],
      );
    }
  }
  for (const row of fixture.scopeCases)
    assert.equal(speedDisplayForSports(row.sports), row.display);
  for (const value of [NaN, Infinity, -Infinity, Number.MIN_VALUE, undefined]) {
    assert.equal(formatSpeed(value, 'run', 'metric'), '—');
    assert.equal(formatSpeed(value, 'swim', 'imperial'), '—');
  }
});

void test('pace sorts follow displayed numbers with invalid pace last; mixed speed keeps zero', () => {
  const rows = [
    { id: 1, average_speed: 10 / 3 },
    { id: 2, average_speed: 2.5 },
    { id: 3, average_speed: 0 },
    { id: 4, average_speed: null },
    { id: 5, average_speed: NaN },
    { id: 6, average_speed: -1 },
  ];
  assert.deepEqual(
    sortActivities(rows, [{ id: 'average_speed', desc: false }], 'run').map(
      (a) => a.id,
    ),
    [1, 2, 6, 5, 4, 3],
  );
  assert.deepEqual(
    sortActivities(rows, [{ id: 'average_speed', desc: true }], 'run').map(
      (a) => a.id,
    ),
    [2, 1, 6, 5, 4, 3],
  );
  assert.deepEqual(
    sortActivities(rows.slice(0, 4), [{ id: 'average_speed', desc: true }]).map(
      (a) => a.id,
    ),
    [1, 2, 3, 4],
  );
});

void test('run and swim details lead with pace, retain speed and elevation without duplicating fields', () => {
  for (const sport_type of ['Run', 'TrailRun', 'VirtualRun', 'Swim'] as const) {
    const result = activityDetailStats(
      {
        sport_type,
        average_speed: 10 / 3,
        max_speed: 4,
        total_elevation_gain: 100,
      },
      'en-US',
    );
    assert.equal(result.headline[2]?.label, 'Average pace');
    assert.equal(
      result.headline[2]?.value,
      sport_type === 'Swim' ? '0:30 min/100 m' : '5:00 min/km',
    );
    const stats = result.groups.flatMap((g) => g.stats);
    assert.equal(
      stats.find((s) => s.id === 'averageSpeed')?.value,
      '12.0 km/h',
    );
    assert.equal(
      stats.find((s) => s.id === 'bestPace')?.value,
      sport_type === 'Swim' ? '0:25 min/100 m' : '4:10 min/km',
    );
    assert.equal(stats.find((s) => s.id === 'elevationGain')?.value, '100 m');
    const ids = [...result.headline, ...stats].map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  }
  for (const average_speed of [0, null, NaN, Infinity]) {
    const result = activityDetailStats(
      { sport_type: 'Run', average_speed },
      'en-US',
    );
    assert.equal(result.headline[2]?.value, '—');
    const invalidBest = activityDetailStats(
      { sport_type: 'Run', max_speed: average_speed },
      'en-US',
    );
    assert.equal(
      invalidBest.groups
        .flatMap((g) => g.stats)
        .some((s) => s.id === 'bestPace'),
      false,
    );
  }
});
