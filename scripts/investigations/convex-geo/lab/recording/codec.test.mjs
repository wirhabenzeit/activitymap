import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { test } from 'node:test';

import { decodeStreamSummary } from '../../../../../src/lib/streams/compact-summary.ts';
import { summarizeStreams } from '../../../../../src/server/strava/stream-summary.ts';
import {
  CHUNK_BYTES,
  CHUNK_SAMPLES,
  decodeChunks,
  decodeWhole,
  encodeChunks,
  encodeWhole,
  validateRecording,
} from './codec.ts';
import { FIXTURE_SAMPLES, generateFixture } from './fixtures.ts';
import { fixtureMatch, recordingSummary } from './processing.ts';

function roundTrip(input) {
  const streams = validateRecording(input);
  const { file, manifest } = encodeWhole(streams);
  const restored = decodeWhole(file, manifest);
  assert.deepEqual(restored, input);
  const chunks = encodeChunks(streams);
  assert.deepEqual(decodeChunks(chunks), input);
  for (const { span, file } of chunks.samples) {
    assert(span <= CHUNK_SAMPLES);
    assert(file.length <= CHUNK_BYTES);
  }
  for (const file of chunks.headers) assert(file.length <= CHUNK_BYTES);
  return { manifest, chunks, restored };
}

for (const [fixture, samples] of Object.entries(FIXTURE_SAMPLES)) {
  test(`${fixture} fixture retains every field and sample (${samples} points)`, () => {
    const input = generateFixture(samples);
    const { manifest, restored } = roundTrip(input);
    assert.deepEqual(Object.values(manifest.counts), Array(6).fill(samples));
    const compact = recordingSummary(restored);
    assert.equal(compact.codec, 'polyline-v1');
    assert.deepEqual(decodeStreamSummary(compact), summarizeStreams(input));
    if (fixture === 'small') {
      const matches = fixtureMatch(restored);
      assert(matches.matches.length > 0);
      assert.deepEqual(matches, fixtureMatch(input));
    }
  });
}

test('retains empty payloads, missing streams, empty arrays and uneven sample bases', () => {
  assert.deepEqual(roundTrip({}).manifest.counts, {});
  const input = {
    altitude: {
      data: [-0, -0.000000001, 999.123456789],
      original_size: 10,
      resolution: 'low',
      series_type: 'distance',
      extra: JSON.parse(
        '{"__proto__":{"data":[-0,null,false]},"toString":"data"}',
      ),
    },
    latlng: {
      data: [
        [-90, 180],
        [-0, 0],
      ],
      original_size: 2,
      resolution: 'high',
      series_type: 'time',
      type: 'latlng',
    },
    watts: {
      data: [],
      original_size: 0,
      resolution: 'medium',
      series_type: 'time',
    },
  };
  assert.deepEqual(roundTrip(input).manifest.counts, {
    altitude: 3,
    latlng: 2,
    watts: 0,
  });
});

test('byte limits bisect sample blocks and split oversized metadata independently', () => {
  const input = generateFixture(CHUNK_SAMPLES);
  const longNumber = 1.2345678901234567e-200;
  const longLatitude = 9.2345678901234567e-200;
  input.distance.data.fill(longNumber);
  input.altitude.data.fill(-longNumber);
  input.latlng.data.fill([longLatitude, -longLatitude]);
  for (const name of ['time', 'watts', 'heartrate'])
    input[name].data.fill(Number.MAX_SAFE_INTEGER);
  input.distance.extra = randomBytes(CHUNK_BYTES).toString('base64');
  const { chunks } = roundTrip(input);
  assert(chunks.headers.length > 1);
  assert(chunks.samples.length > 1);
  assert.equal(
    chunks.samples.reduce((count, chunk) => count + chunk.span, 0),
    CHUNK_SAMPLES,
  );
});

test('summary falls back losslessly when the existing compact codec refuses precision', () => {
  const input = generateFixture(96);
  input.altitude.data.fill(1e12);
  assert.deepEqual(recordingSummary(input), summarizeStreams(input));
});

test('a recording survives even when the summary sampler overflows', () => {
  const input = generateFixture(96);
  input.altitude.data.fill(Number.MAX_VALUE);
  assert.equal(recordingSummary(roundTrip(input).restored), null);
});

test('rejects invalid streams and corrupt manifests', () => {
  assert.throws(
    () => validateRecording({ unexpected: {} }),
    /Invalid recording/,
  );
  const streams = generateFixture(3);
  assert.throws(
    () =>
      validateRecording({
        ...streams,
        time: { ...streams.time, original_size: 1 },
      }),
    /Invalid recording/,
  );
  assert.throws(
    () =>
      validateRecording({
        ...streams,
        latlng: { ...streams.latlng, data: [[90.1, 0]] },
      }),
    /Invalid recording/,
  );
  const { file, manifest } = encodeWhole(streams);
  assert.throws(
    () => decodeWhole(file, { ...manifest, contentHash: 'other' }),
    /checksum/,
  );
  assert.throws(
    () =>
      decodeWhole(file, {
        ...manifest,
        counts: { ...manifest.counts, time: 4 },
      }),
    /count/,
  );
  assert.throws(
    () => decodeWhole(file.subarray(1), manifest),
    /compressed size/,
  );
  assert.throws(
    () =>
      decodeChunks({ headers: [Buffer.alloc(CHUNK_BYTES + 1)], samples: [] }),
    /budget/,
  );
  assert.throws(
    () =>
      decodeChunks({
        headers: [gzipSync(Buffer.alloc(CHUNK_BYTES))],
        samples: [],
      }),
    /Cannot create a Buffer|larger/,
  );
});
