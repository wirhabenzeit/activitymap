import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { config } from 'dotenv';

import type { ActivityPlacesResponse } from '../src/contracts/activity-places';
import { canonicalJson, sha256 } from '../src/server/places/catalogue-artifact';
import {
  DEFAULT_MATCHER_POLICY,
  MATCHER_VERSION,
  parametersHash,
  validatePolicy,
} from '../src/server/places/policy';

const { values } = parseArgs({
  options: {
    athlete: { type: 'string' },
    limit: { type: 'string' },
    compare: { type: 'boolean', default: false },
    out: {
      type: 'string',
      default: 'output/quality/batch-places/benchmark.json',
    },
  },
});
if (
  !values.athlete ||
  !/^[1-9][0-9]*$/.test(values.athlete) ||
  !Number.isSafeInteger(Number(values.athlete))
)
  throw new Error('Supply --athlete with your local Strava athlete ID');
const limit = values.limit === undefined ? undefined : Number(values.limit);
if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
  throw new Error('Invalid --limit');
config({ path: '.env.development.local', quiet: true });
config({ path: '.env', quiet: true });
const { resolveDatabaseConnection } =
  await import('../src/server/db/connection');
if (
  !['localhost', '127.0.0.1', 'db.localtest.me'].includes(
    new URL(resolveDatabaseConnection(process.env).connectionString).hostname,
  )
)
  throw new Error('Benchmark requires the local development database');
const { db } = await import('../src/server/db');
const { sql } = await import('drizzle-orm');
const { loadBatchPlaceCatalogue } =
  await import('../src/server/repositories/batch-place-catalogue');
const { createPlaceDiscoveryRepository } =
  await import('../src/server/repositories/places');
const { createBatchActivityPlaceMatcher } =
  await import('../src/server/application/batch-activity-places');
const { matchActivityPlaces } =
  await import('../src/server/application/match-activity-places');
const policy = validatePolicy({
  ...DEFAULT_MATCHER_POLICY,
  peakRadiusM: 72,
  peakVerticalToleranceM: 72,
});
const loading = performance.now();
const snapshot = await loadBatchPlaceCatalogue();
const catalogueLoadMs = performance.now() - loading;
const source = (
  await db.execute<{ id: string; user_id: string }>(sql`
  SELECT a.id::text,u.id AS user_id FROM activities a
  JOIN "user" u ON u.athlete_id=a.athlete JOIN activity_streams s ON s.activity_id=a.id
  WHERE a.athlete=${Number(values.athlete)} AND s.payload IS NOT NULL
    AND s.invalidated_at IS NULL AND s.source_version=md5(activity_stream_source(a)::text)
    AND EXISTS (SELECT 1 FROM account c WHERE c."userId"=u.id AND c."providerId"='strava'
      AND c."accountId"=a.athlete::text AND c.revoked_at IS NULL AND c.scheduled_erasure_at IS NULL)
  ORDER BY a.id
`)
).rows;
if (!source.length) throw new Error('No eligible current stored activities');
const selected =
  limit && limit < source.length
    ? Array.from(
        { length: limit },
        (_, i) => source[Math.floor((i * source.length) / limit)]!,
      )
    : source;
const expected = new Map<string, { input: string; result: string }>();
type Measurement = {
  wallSeconds: number;
  applicationCpuSeconds: number;
  statuses: Record<string, number>;
  medianActivityMs: number;
  p95ActivityMs: number;
  activities: number;
  matchedActivities: number;
  activityPlacePairs: number;
  visits: number;
};
const run = async (
  name: string,
  batch?: ReturnType<typeof createBatchActivityPlaceMatcher>,
): Promise<Measurement> => {
  const started = performance.now(),
    cpu = process.cpuUsage();
  const timings: number[] = [],
    statuses: Record<string, number> = {};
  let next = 0;
  let matchedActivities = 0,
    activityPlacePairs = 0,
    visits = 0;
  const worker = async () => {
    while (next < selected.length) {
      const activity = selected[next++]!,
        before = performance.now();
      const result = await db.transaction(
        async (tx) => {
          await tx.execute(
            sql`SELECT set_config('statement_timeout','10000',true)`,
          );
          const row = (
            await tx.execute<{
              generation: string;
              revision: string;
              source_version: string;
              too_large: boolean;
              payload: unknown;
            }>(sql`
          SELECT s.generation,s.revision::text,s.source_version,
            jsonb_array_length(COALESCE(s.payload->'latlng'->'data','[]'::jsonb))>${policy.maxSamples} AS too_large,
            CASE WHEN jsonb_array_length(COALESCE(s.payload->'latlng'->'data','[]'::jsonb))>${policy.maxSamples} THEN NULL
              ELSE jsonb_build_object('latlng',s.payload->'latlng','time',s.payload->'time','distance',s.payload->'distance','altitude',s.payload->'altitude') END AS payload
          FROM activity_streams s JOIN activities a ON a.id=s.activity_id
          WHERE a.id=${activity.id}::bigint AND a.athlete=${Number(values.athlete)}
            AND s.invalidated_at IS NULL AND s.source_version=md5(activity_stream_source(a)::text)
        `)
          ).rows[0];
          if (!row)
            throw new Error('Stored inputs changed during the benchmark');
          const input = {
            userId: activity.user_id,
            activityId: activity.id,
            input: row,
          };
          const exact = createPlaceDiscoveryRepository({
            execute: async <T extends Record<string, unknown>>(
              query: Parameters<typeof tx.execute>[0],
            ) => (await tx.execute<T>(query)).rows as T[],
          });
          const response: ActivityPlacesResponse = batch
            ? await batch.match(input)
            : await matchActivityPlaces({
                ...input,
                catalogue: snapshot.catalogue,
                policy,
                discover: exact.discover,
              });
          if (values.compare) {
            const identity = canonicalJson({
              generation: row.generation,
              revision: row.revision,
              sourceVersion: row.source_version,
            });
            const digest = sha256(canonicalJson(response));
            if (batch) {
              assert.equal(
                identity,
                expected.get(activity.id)?.input,
                'Input changed between benchmark passes',
              );
              assert.equal(
                digest,
                expected.get(activity.id)?.result,
                `Batch output differs for activity ${activity.id}`,
              );
            } else
              expected.set(activity.id, { input: identity, result: digest });
          }
          return response;
        },
        { accessMode: 'read only', isolationLevel: 'repeatable read' },
      );
      timings.push(performance.now() - before);
      statuses[result.status] = (statuses[result.status] ?? 0) + 1;
      if (result.places.length) matchedActivities++;
      activityPlacePairs += result.places.length;
      for (const place of result.places) visits += place.visits.length;
      if (timings.length % 500 === 0)
        console.log(
          JSON.stringify({
            pass: name,
            processed: timings.length,
            total: selected.length,
            elapsedSeconds: (performance.now() - started) / 1000,
          }),
        );
    }
  };
  await Promise.all([worker(), worker()]);
  const elapsed = performance.now() - started,
    cpuUsed = process.cpuUsage(cpu);
  timings.sort((a, b) => a - b);
  return {
    activities: timings.length,
    matchedActivities,
    activityPlacePairs,
    visits,
    wallSeconds: elapsed / 1000,
    applicationCpuSeconds: (cpuUsed.user + cpuUsed.system) / 1e6,
    statuses,
    medianActivityMs: timings[Math.floor(timings.length / 2)]!,
    p95ActivityMs: timings[Math.ceil(timings.length * 0.95) - 1]!,
  };
};
// An optional development oracle, never a fallback inside the local run.
const baseline = values.compare ? await run('database') : undefined;
const build = performance.now();
const batch = createBatchActivityPlaceMatcher({
  snapshot,
  policy,
});
const indexBuildMs = performance.now() - build;
const optimized = await run('batch', batch);
const active = (
  await db.execute<{ active: boolean; revision: string }>(
    sql`SELECT active, (SELECT revision::text FROM place_catalogue_revision WHERE singleton) AS revision FROM place_catalogues WHERE snapshot_id=${snapshot.catalogue.manifest.catalogue_snapshot_id}`,
  )
).rows[0];
assert.equal(active?.active, true, 'Catalogue changed during the benchmark');
assert.equal(
  active.revision,
  snapshot.revision,
  'Catalogue contents changed during the benchmark',
);
const report = {
  measuredAt: new Date().toISOString(),
  matcherVersion: MATCHER_VERSION,
  discoveryVersion: batch.discoveryVersion,
  parametersHash: parametersHash(policy),
  policy,
  catalogueSnapshotId: snapshot.catalogue.manifest.catalogue_snapshot_id,
  catalogueRevision: snapshot.revision,
  cataloguePlaces: snapshot.places.length,
  catalogueLoadMs,
  indexBuildMs,
  concurrency: 2,
  baseline,
  optimized,
  speedup: baseline
    ? baseline.wallSeconds /
      (optimized.wallSeconds + (catalogueLoadMs + indexBuildMs) / 1000)
    : null,
  parityVerified: values.compare ? expected.size : null,
  stats: batch.stats,
  peakProcessRssMiB: process.resourceUsage().maxRSS / 1024,
  scope:
    'Local read-only full pipeline, including stored stream reads. The local pass uses local discovery exclusively, with no place or coverage queries after the snapshot load. --compare adds a separate database pass and checks complete API results, including repeated visit positions and non-complete states. No result writes, job claims, Strava calls or raw coordinates in this report.',
};
await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(0);
