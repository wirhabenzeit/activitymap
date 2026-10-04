import assert from 'node:assert/strict';
import test from 'node:test';
import { activityDetailStats } from './activity-detail-stats';

void test('headlines use actual moving time and secondary fields occur once in topic groups', () => {
  const result = activityDetailStats(
    {
      distance: 182600,
      moving_time: 22320,
      elapsed_time: 25140,
      total_elevation_gain: 1415,
      average_speed: 8,
      max_speed: 18,
      elev_low: 406,
      elev_high: 743,
      average_watts: 206,
      max_watts: 788,
      weighted_average_watts: 254,
      kilojoules: 4630,
      average_heartrate: 120,
      max_heartrate: 172,
      calories: 2000,
      kudos_count: 2,
      achievement_count: 1,
      comment_count: 0,
      photo_count: 2,
      total_photo_count: 4,
      commute: false,
      private: false,
      trainer: false,
      manual: false,
      flagged: false,
      geometryState: 'detailed',
      id: 123,
    },
    'en-US',
  );
  assert.deepEqual(
    result.headline.map(({ id }) => id),
    ['distance', 'movingTime', 'elevationGain'],
  );
  assert.equal(result.headline[1]?.value, '6h 12m');
  assert.deepEqual(
    result.groups.map(({ id }) => id),
    [
      'time-speed',
      'elevation',
      'power',
      'heart-rate',
      'energy',
      'social',
      'activity',
    ],
  );
  const stats = result.groups.flatMap(({ stats }) => stats);
  assert.equal(stats.find(({ id }) => id === 'elapsedTime')?.value, '6h 59m');
  assert.equal(stats.find(({ id }) => id === 'photos')?.value, '4');
  const ids = [...result.headline, ...stats].map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 25);
  assert.ok(!ids.includes('id'));
});

void test('missing siblings and invalid values never hide zero or false', () => {
  const result = activityDetailStats(
    {
      moving_time: null,
      elapsed_time: 0,
      average_watts: null,
      max_watts: 0,
      average_heartrate: Number.NaN,
      elev_low: -12,
      total_elevation_gain: 0,
      private: false,
    },
    'en-US',
  );
  assert.equal(result.headline[1]?.value, '—');
  assert.equal(result.headline[2]?.value, '0 m');
  assert.deepEqual(
    result.groups.map(({ id }) => id),
    ['time-speed', 'elevation', 'power', 'activity'],
  );
  assert.deepEqual(
    result.groups
      .flatMap(({ stats }) => stats)
      .map(({ id, value }) => [id, value]),
    [
      ['elapsedTime', '0m'],
      ['elevLow', '-12 m'],
      ['maxWatts', '0 W'],
      ['privacy', 'No'],
    ],
  );
});
