import { writeFile } from 'node:fs/promises';
import { compactStreamCorpus } from './fixtures/compact-stream-corpus';
import { encodeStreamSummary } from '../src/lib/streams/compact-summary';
import { activityCompactStreamSummaryDTOSchema } from '../src/contracts/v1/activity-streams';

// Synthetic encoded-payload budget, deliberately separate from browser/SwiftData
// disk allocation, HTTP compression and physical-device performance measurements.
const corpus = compactStreamCorpus().map((entry) => ({
  name: entry.name,
  summary: encodeStreamSummary(entry.summary),
}));
const count = 5_000;
const batchSize = 100;
const scenarios = [
  { name: 'mixed-corpus', entries: corpus },
  {
    name: 'largest-corpus-summary',
    entries: [
      corpus.reduce((largest, entry) =>
        JSON.stringify(entry.summary).length >
        JSON.stringify(largest.summary).length
          ? entry
          : largest,
      ),
    ],
  },
];
const rows = scenarios.map(({ name, entries }) => {
  const summaries = Array.from({ length: count }, (_, index) => {
    const entry = entries[index % entries.length]!;
    return activityCompactStreamSummaryDTOSchema.parse({
      activity_id: String(10_000_000_000 + index),
      metadata: {
        generation: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        revision: String(index + 1),
        state: 'current',
        fetch_status: 'succeeded',
        available_types: [
          'time',
          'distance',
          'altitude',
          'latlng',
          'watts',
          'heartrate',
        ].filter((key) => key in entry.summary),
        fetched_at: '2026-10-10T00:00:00.000Z',
        expires_at: null,
      },
      summary: entry.summary,
      last_error: null,
      next_retry_at: null,
    });
  });
  const payloadBytes = summaries.map((dto) =>
    Buffer.byteLength(JSON.stringify(dto)),
  );
  const batchBytes: number[] = [];
  for (let start = 0; start < count; start += batchSize) {
    batchBytes.push(
      Buffer.byteLength(
        JSON.stringify({
          summaries: summaries.slice(start, start + batchSize),
        }),
      ),
    );
  }
  return {
    name,
    activities: count,
    batchSize,
    requestsForInitialCatchUp: batchBytes.length,
    encodedDTOBytes: payloadBytes.reduce((sum, bytes) => sum + bytes, 0),
    largestEncodedDTOBytes: Math.max(...payloadBytes),
    largestBatchDataBytes: Math.max(...batchBytes),
  };
});
const report = {
  description:
    '5,000 synthetic compact summary DTOs validated through the production schema. ' +
    'UTF-8 JSON bytes, excluding database indexes/record wrappers, HTTP envelopes and compression. ' +
    'The largest scenario repeats the largest fixture, not a worst-case codec bound. ' +
    'These are payload budgets, not measured IndexedDB/SwiftData disk use or device performance.',
  rows,
};
await writeFile(
  'docs/summary-sync-payload-budget.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
