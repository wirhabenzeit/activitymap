import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import {
  decodeStreamSummary,
  encodeStreamSummary,
} from '../src/lib/streams/compact-summary';
import { compactStreamCorpus } from './fixtures/compact-stream-corpus';

const corpus = compactStreamCorpus().map((entry) => ({
  ...entry,
  compact: encodeStreamSummary(entry.summary),
}));
const sizes = (value: unknown) => {
  const json = JSON.stringify(value);
  return {
    json: Buffer.byteLength(json),
    gzip: gzipSync(json).length,
    brotli: brotliCompressSync(json, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
    }).length,
  };
};
const timings = (fn: () => unknown) => {
  for (let i = 0; i < 100; i++) fn();
  const runs = Array.from({ length: 1000 }, () => {
    const start = performance.now();
    fn();
    return (performance.now() - start) * 1000;
  }).sort((a, b) => a - b);
  return { medianUs: runs[500], p95Us: runs[950] };
};
const rows = corpus.map((entry) => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(decodeStreamSummary(entry.compact))),
    JSON.parse(JSON.stringify(entry.summary)),
  );
  return {
    name: entry.name,
    rawSamples: entry.rawSamples,
    samples: entry.compact.count,
    legacy: sizes(entry.summary),
    compact: sizes(entry.compact),
    encode: timings(() => encodeStreamSummary(entry.summary)),
    decode: timings(() => decodeStreamSummary(entry.compact)),
  };
});
const report = {
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  description:
    'Synthetic summary payloads, Node gzip defaults/Brotli q5. Times are local warmed calls. No deployed HTTP, activity-sync page or device-memory claim.',
  rows,
};
await writeFile(
  '/tmp/activitymap-compact-benchmark-vectors.json',
  JSON.stringify(corpus),
);
await writeFile(
  'docs/compact-stream-summary-benchmark.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
