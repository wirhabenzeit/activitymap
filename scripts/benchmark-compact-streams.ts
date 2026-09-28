import assert from 'node:assert/strict';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import postgres from 'postgres';
import { compactStreamCorpus } from './fixtures/compact-stream-corpus';
import {
  encodeStreamSummary,
  decodeStreamSummary,
} from '../src/lib/streams/compact-summary';

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
const databaseUrl = process.env.BENCHMARK_DATABASE_URL;
let postgresColumns: unknown = null;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')
  )
    throw new Error('Benchmark accepts only a local *_test database');
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await client`create temporary table compact_benchmark (name text, legacy jsonb, compact jsonb)`;
    for (const entry of corpus)
      await client`insert into compact_benchmark values (${entry.name}, ${JSON.stringify(entry.summary)}::jsonb, ${JSON.stringify(entry.compact)}::jsonb)`;
    postgresColumns =
      await client`select name, pg_column_size(legacy) as legacy_bytes, pg_column_size(compact) as compact_bytes from compact_benchmark order by name`;
  } finally {
    await client.end();
  }
}
const report = {
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  description:
    'Synthetic summary payloads, Node gzip defaults/Brotli q5; PostgreSQL pg_column_size on stored JSONB, not full-table/disk allocation. Times are local warmed calls. No deployed HTTP, activity-sync page or device-memory claim.',
  rows,
  postgresColumns,
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
