import assert from 'node:assert/strict';
import test from 'node:test';
import { RAW_STREAMS_FIXTURE } from './streams.fixture';
import {
  STREAM_SUMMARY_VERSION,
  streamSummarySchema,
  summarizeStreams,
} from './stream-summary';
import type { RawActivityStreams } from './streams';

const meta = {
  original_size: 0,
  resolution: 'high',
  series_type: 'distance',
} as const;

function ride(samples: number): RawActivityStreams {
  const range = Array.from({ length: samples }, (_, index) => index);
  const withSize = { ...meta, original_size: samples };
  return {
    distance: { ...withSize, data: range.map((index) => index * 5) },
    time: { ...withSize, data: range.map((index) => index * 2) },
    altitude: {
      ...withSize,
      data: range.map((index) => 400 + Math.sin(index / 500) * 100),
    },
    heartrate: { ...withSize, data: range.map((index) => 120 + (index % 7)) },
    watts: { ...withSize, data: range.map((index) => 200 + (index % 11)) },
    latlng: {
      ...withSize,
      data: range.map((index) => [47 + index / 1e5, 8 + index / 1e5]),
    },
  };
}

void test('long activities are reduced to aligned, bounded series', () => {
  const summary = summarizeStreams(ride(18_000), 300);
  assert.equal(summary.version, STREAM_SUMMARY_VERSION);
  assert.equal(summary.basis, 'distance');
  for (const key of [
    'time',
    'distance',
    'altitude',
    'heartrate',
    'watts',
    'latlng',
  ] as const) {
    assert.equal(summary[key]?.length, 300, key);
  }
  // Evenly spaced along distance and still increasing.
  const distance = summary.distance!;
  assert.ok(
    distance.every(
      (value, index) => index === 0 || value > distance[index - 1]!,
    ),
  );
  assert.ok(Math.abs(distance[1]! - distance[0]! - 300) < 1);
  // Averages keep values in the original range.
  assert.ok(summary.heartrate!.every((value) => value >= 120 && value <= 126));
  assert.ok(streamSummarySchema.safeParse(summary).success);
  assert.ok(JSON.stringify(summary).length < 30_000);
});

void test('short activities keep one point per sample', () => {
  const summary = summarizeStreams(ride(40), 300);
  assert.equal(summary.distance!.length, 40);
  assert.deepEqual(summary.distance!.slice(0, 3), [0, 5, 10]);
});

void test('streams with different sampling are left out', () => {
  // The fixture's heartrate stream is shorter and sampled by distance.
  const summary = summarizeStreams(RAW_STREAMS_FIXTURE);
  assert.equal(summary.basis, 'distance');
  assert.ok(summary.altitude);
  assert.equal(summary.heartrate, undefined);
});

void test('falls back to time, and to nothing without a usable axis', () => {
  const indoor = ride(1_000);
  delete indoor.distance;
  delete indoor.latlng;
  const summary = summarizeStreams(indoor, 100);
  assert.equal(summary.basis, 'time');
  assert.equal(summary.watts!.length, 100);
  assert.equal(summary.distance, undefined);

  const none = { version: STREAM_SUMMARY_VERSION, basis: null };
  assert.deepEqual(summarizeStreams({}), none);
  assert.deepEqual(
    summarizeStreams({
      time: { ...meta, series_type: 'time', original_size: 1, data: [0] },
    }),
    none,
  );
});
