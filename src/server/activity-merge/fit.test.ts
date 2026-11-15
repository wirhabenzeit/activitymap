import assert from 'node:assert/strict';

import { Decoder, Stream } from '@garmin/fitsdk';
import test from 'node:test';

import {
  type MergeSource,
  MissingMergeSamplesError,
  combineRecordings,
} from './combine';
import { encodeMergedFit, fitSport } from './fit';

const start = new Date('2026-06-01T06:00:00Z');

function source(
  id: string,
  startOffsetSeconds: number,
  count: number,
  overrides: Partial<MergeSource['streams']> = {},
): MergeSource {
  const time = Array.from({ length: count }, (_, index) => index);
  return {
    id,
    startDate: new Date(start.getTime() + startOffsetSeconds * 1000),
    elapsedTime: count - 1,
    movingTime: count - 1,
    distance: (count - 1) * 5,
    totalElevationGain: 10,
    streams: {
      time: { data: time },
      distance: { data: time.map((value) => value * 5) },
      latlng: {
        data: time.map((value) => [46 + value * 0.0001, 8] as [number, number]),
      },
      altitude: { data: time.map((value) => 500 + value) },
      heartrate: { data: time.map((value) => (value === 0 ? -1 : 120)) },
      watts: { data: time.map(() => null) },
      ...overrides,
    },
  };
}

void test('parts are concatenated with continuing distance and kept breaks', () => {
  const recording = combineRecordings([
    source('b', 3600, 11),
    source('a', 0, 11),
  ]);
  assert.equal(recording.samples.length, 22);
  assert.deepEqual(
    recording.laps.map((lap) => [lap.sourceId, lap.first, lap.last]),
    [
      ['a', 0, 11],
      ['b', 11, 22],
    ],
  );
  // The second part continues from the first part's 50 m.
  assert.equal(recording.samples[11]!.distance, 50);
  assert.equal(recording.samples[21]!.distance, 100);
  assert.equal(recording.distance, 100);
  // Elapsed spans the break; timer time does not.
  assert.equal(recording.end - recording.start, 3610);
  assert.equal(recording.timerTime, 20);
  // Missing heart rate (-1) and power (null) samples are left out.
  assert.equal(recording.samples[0]!.heartrate, undefined);
  assert.equal(recording.samples[0]!.watts, undefined);
  assert.equal(recording.hasPosition, true);
});

void test('overlapping samples never run backwards in time', () => {
  const recording = combineRecordings([source('a', 0, 11), source('b', 5, 11)]);
  const timestamps = recording.samples.map((sample) => sample.timestamp);
  assert.deepEqual(
    timestamps,
    [...timestamps].sort((a, b) => a - b),
  );
  assert.equal(new Set(timestamps).size, timestamps.length);
});

void test('distance falls back to the route when a part has no distance stream', () => {
  const recording = combineRecordings([
    source('a', 0, 3, { distance: undefined }),
  ]);
  const last = recording.samples[2]!.distance!;
  // Two steps of 0.0001° latitude, about 11 m each.
  assert.ok(last > 21 && last < 23, String(last));
});

void test('the FIT file decodes to the merged session, laps and records', () => {
  const recording = combineRecordings([
    source('a', 0, 11),
    source('b', 3600, 11),
  ]);
  const bytes = encodeMergedFit(recording, {
    sport: 'GravelRide',
    now: new Date('2026-06-02T00:00:00Z'),
  });
  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  assert.equal(decoder.isFIT(), true);
  assert.equal(decoder.checkIntegrity(), true);
  const { messages: decoded, errors } = decoder.read();
  assert.deepEqual(errors, []);
  // Loosely typed: the decoder's own types make every field optional.
  const messages = decoded as unknown as Record<
    string,
    Record<string, never>[]
  > & {
    recordMesgs: { timestamp: Date; positionLat: number; distance: number }[];
    lapMesgs: { startTime: Date }[];
    sessionMesgs: Record<string, unknown>[];
    eventMesgs: { eventType: string }[];
    activityMesgs: { numSessions: number }[];
  };

  assert.equal(messages.recordMesgs.length, 22);
  const firstRecord = messages.recordMesgs[0]!;
  assert.equal(firstRecord.timestamp.getTime(), start.getTime());
  assert.ok(
    Math.abs(Number(firstRecord.positionLat) * (180 / 2 ** 31) - 46) < 1e-6,
  );
  assert.equal(messages.recordMesgs[21]!.distance, 100);

  assert.equal(messages.lapMesgs.length, 2);
  assert.equal(
    messages.lapMesgs[1]!.startTime.getTime(),
    start.getTime() + 3600_000,
  );

  const [session] = messages.sessionMesgs;
  assert.equal(session!.sport, 'cycling');
  assert.equal(session!.subSport, 'gravelCycling');
  assert.equal(session!.totalElapsedTime, 3610);
  assert.equal(session!.totalTimerTime, 20);
  assert.equal(session!.totalDistance, 100);
  assert.equal(session!.numLaps, 2);
  assert.equal(session!.avgHeartRate, 120);

  // Each break is a timer stop followed by a start.
  assert.deepEqual(
    messages.eventMesgs.map((event: { eventType: string }) => event.eventType),
    ['start', 'stopAll', 'start', 'stopAll'],
  );
  assert.equal(messages.activityMesgs[0]!.numSessions, 1);
});

void test('sports map to FIT sports, with trainer rides indoors', () => {
  assert.deepEqual(fitSport('Run'), { sport: 'running', subSport: 'generic' });
  assert.deepEqual(fitSport('Ride', true), {
    sport: 'cycling',
    subSport: 'indoorCycling',
  });
  assert.deepEqual(fitSport('Yoga'), { sport: 'generic', subSport: 'generic' });
});

void test('every selected source must contribute usable samples', () => {
  for (const unusable of [
    source('b', 3600, 0),
    source('b', 3600, 1, { time: { data: [NaN] } }),
    source('b', 0, 2), // Completely shadowed by the previous recording.
  ]) {
    assert.throws(
      () => combineRecordings([source('a', 0, 11), unusable]),
      (error) =>
        error instanceof MissingMergeSamplesError && error.sourceId === 'b',
    );
  }
});
