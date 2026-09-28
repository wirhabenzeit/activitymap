import assert from 'node:assert/strict';
import test from 'node:test';
import vectors from '../../../shared/stream-codec/vectors.v1.json';
import {
  decodeStreamSummary,
  encodeStreamSummary,
  MAX_SCALED_VALUE,
} from './compact-summary';
import { streamSummarySchema } from '~/server/strava/stream-summary';

for (const vector of vectors) {
  void test(`compact golden vector: ${vector.name}`, () => {
    const summary = streamSummarySchema.parse(vector.summary);
    assert.deepEqual(encodeStreamSummary(summary), vector.compact);
    assert.deepEqual(decodeStreamSummary(vector.compact), summary);
  });
}
void test('bounded decoder rejects unknown versions, malformed encodings and allocations', () => {
  const base = {
    codec: 'polyline-v1',
    version: 1,
    basis: 'distance',
    count: 1,
    distance: '?',
  };
  for (const change of [
    { codec: 'polyline-v2' },
    { version: 2 },
    { count: -1 },
    { count: 301 },
    { count: 1.5 },
    { distance: '' },
    { distance: '??' },
    { distance: '_' },
    { distance: '_?' },
    { distance: '!' },
    { distance: 'é' },
    { distance: '~'.repeat(10) },
    { distance: '~'.repeat(8) + '^' },
    { altitude: '' },
    { basis: 'time' },
    { basis: null },
    { extra: 'unknown' },
  ])
    assert.throws(
      () => decodeStreamSummary({ ...base, ...change }),
      JSON.stringify(change),
    );
});
void test('encoding rejects extra precision, misalignment, coordinates and unsupported sampling versions', () => {
  const base = { version: 1, basis: 'distance' as const, distance: [0, 1] };
  for (const summary of [
    { ...base, distance: [0, 0.01] },
    { ...base, altitude: [5] },
    { ...base, distance: [0, Infinity] },
    { ...base, version: 2 },
    {
      ...base,
      latlng: [
        [0, 0],
        [91, 0],
      ] as [number, number][],
    },
    { ...base, distance: [0, (MAX_SCALED_VALUE + 1) / 10] },
    { ...base, distance: Array<number>(301).fill(0) },
  ])
    assert.throws(() => encodeStreamSummary(summary));
});
void test('randomized rounded summaries round-trip including signed deltas and all 300 samples', () => {
  let seed = 230;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let run = 0; run < 50; run++) {
    const distance = Array.from(
      { length: 300 },
      () => Math.round(random() * 1e8) / 10,
    );
    const altitude = Array.from(
      { length: 300 },
      () => Math.round((random() - 0.5) * 1e5) / 10,
    );
    const summary = {
      version: 1,
      basis: 'distance' as const,
      distance,
      altitude,
    };
    assert.deepEqual(
      decodeStreamSummary(encodeStreamSummary(summary)),
      summary,
    );
  }
});
