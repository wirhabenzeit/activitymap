import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import postgres from 'postgres';

import { createBatchActivityPlaceMatcher } from '../../../../src/server/application/batch-activity-places.ts';
import { DEFAULT_MATCHER_POLICY } from '../../../../src/server/places/policy.ts';
import { placeQueryWindows } from '../../../../src/server/places/query-windows.ts';
import { prepareTrack } from '../../../../src/server/places/track-sections.ts';

const run = promisify(execFile);
const stress = process.argv.includes('--stress');
const cwd = fileURLToPath(new URL('.', import.meta.url));
const catalogueRow = JSON.parse(
  await readFile(new URL('results/catalogue.json', import.meta.url), 'utf8'),
);
const records = (
  await readFile(new URL('results/places.jsonl', import.meta.url), 'utf8')
)
  .trim()
  .split('\n')
  .map((x) => JSON.parse(x));
const places = records.map((p) => p.metadata);
const catalogue = {
  manifest: catalogueRow.manifest,
  coverage: catalogueRow.coverage,
};
const policy = {
  ...DEFAULT_MATCHER_POLICY,
  peakRadiusM: 72,
  peakVerticalToleranceM: 72,
};
const reference = createBatchActivityPlaceMatcher({
  snapshot: { catalogue, places },
  policy,
});
const sql = postgres('postgres://postgres:postgres@localhost:5432/main', {
  max: 1,
});
let rows;
try {
  rows = await sql.begin('read only', async (tx) =>
    stress
      ? tx`
    WITH longest AS (
      SELECT activity_id FROM activity_streams WHERE invalidated_at IS NULL AND payload->'latlng'->'data' IS NOT NULL
      ORDER BY jsonb_array_length(payload->'latlng'->'data') DESC,activity_id LIMIT 8
    ), busiest AS (
      SELECT s.activity_id FROM activity_streams s JOIN activity_place_checks c ON c.activity_id=s.activity_id
      WHERE s.invalidated_at IS NULL AND s.payload->'latlng'->'data' IS NOT NULL
      ORDER BY jsonb_array_length(COALESCE(c.result->'places','[]'::jsonb)) DESC,s.activity_id LIMIT 8
    ), chosen AS (SELECT activity_id FROM longest UNION SELECT activity_id FROM busiest)
    SELECT row_number() OVER (ORDER BY s.activity_id)::integer AS bucket,jsonb_array_length(s.payload->'latlng'->'data') AS samples,s.payload
    FROM activity_streams s JOIN chosen USING(activity_id) ORDER BY s.activity_id
  `
      : tx`
    WITH eligible AS (
      SELECT payload, jsonb_array_length(payload->'latlng'->'data') AS samples,
        ntile(24) OVER (ORDER BY jsonb_array_length(payload->'latlng'->'data'),activity_id) AS bucket
      FROM activity_streams WHERE invalidated_at IS NULL AND payload->'latlng'->'data' IS NOT NULL
    ) SELECT DISTINCT ON (bucket) bucket,samples,payload FROM eligible ORDER BY bucket,samples
  `,
  );
} finally {
  await sql.end();
}
assert(rows.length > 0, 'No local recorded GPS fixtures');
const results = [];
for (const row of rows) {
  const preparedTrack = prepareTrack(row.payload, policy);
  const input = {
    userId: 'lab',
    activityId: String(row.bucket),
    input: { payload: row.payload, generation: 'lab', revision: '1' },
  };
  const baseline = await reference.match(input, preparedTrack);
  const windows = placeQueryWindows(
    preparedTrack.geometry,
    policy.discoveryRadiusM,
  );
  const expected = places.filter((p) =>
    windows.some(
      (b) =>
        p.location.longitude >= b.west &&
        p.location.longitude <= b.east &&
        p.location.latitude >= b.south &&
        p.location.latitude <= b.north,
    ),
  );
  const item = {
    fixture: row.bucket,
    samples: row.samples,
    windows: windows.length,
    baselineStatus: baseline.status,
    baselinePlaces: baseline.places.length,
  };
  try {
    const start = performance.now();
    const { stdout } = await run(
      './node_modules/.bin/convex',
      [
        'run',
        'lab:tiledWindows',
        JSON.stringify({
          dataset: catalogueRow.snapshot_id,
          windows,
          nonce: `replay-${Date.now()}`,
        }),
        '--deployment',
        'spotted-fennec-603',
      ],
      { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 180000 },
    );
    const response = JSON.parse(stdout);
    assert.deepEqual(
      response.places.map((p) => p.id).sort(),
      expected.map((p) => p.id).sort(),
      'Candidate rectangle parity',
    );
    const matcher = createBatchActivityPlaceMatcher({
      snapshot: { catalogue, places: response.places, windows },
      policy,
    });
    assert.deepEqual(
      await matcher.match(input, preparedTrack),
      baseline,
      'Complete matching response parity',
    );
    Object.assign(item, {
      parity: true,
      candidates: response.places.length,
      pages: response.pages,
      scanned: response.scanned,
      tiles: response.tiles,
      serverMs: response.elapsedMs,
      cliWallMs: Math.round(performance.now() - start),
    });
  } catch (error) {
    Object.assign(item, {
      parity: false,
      error: String(error.message).slice(0, 1000),
    });
  }
  results.push(item);
  console.log(JSON.stringify(item));
  await writeFile(
    new URL(
      stress ? 'results/replay-stress.json' : 'results/replay.json',
      import.meta.url,
    ),
    JSON.stringify(
      {
        dataset: catalogueRow.snapshot_id,
        catalogueCount: places.length,
        selection: stress
          ? 'Union of eight longest GPS recordings and eight recordings with most persisted place matches'
          : '24 GPS sample-count strata; first recording per stratum',
        results,
      },
      null,
      2,
    ),
  );
}
if (results.some((r) => !r.parity)) process.exitCode = 1;
