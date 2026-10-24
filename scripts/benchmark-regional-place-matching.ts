import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { config } from 'dotenv';

import type { ActivityPlacesResponse } from '../src/contracts/activity-places';
import { MATCHING_RECIPE_HASH } from '../src/server/places/matching-version';
import type { MatchingCandidate } from '../src/server/repositories/place-matching';

const { values } = parseArgs({
  options: {
    athlete: { type: 'string' },
    activity: { type: 'string' },
    limit: { type: 'string' },
    out: {
      type: 'string',
      default: 'output/quality/batch-places/regional.json',
    },
  },
});
if (
  !values.athlete ||
  !/^[1-9][0-9]*$/.test(values.athlete) ||
  !Number.isSafeInteger(Number(values.athlete))
)
  throw new Error('Supply --athlete');
const limit = values.limit === undefined ? undefined : Number(values.limit);
if (values.activity && !/^[1-9][0-9]*$/.test(values.activity))
  throw new Error('Invalid --activity');
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
  throw new Error('Regional benchmark requires the local development database');
const { db } = await import('../src/server/db');
const { sql } = await import('drizzle-orm');
const { createPlaceMatchingRepository } =
  await import('../src/server/repositories/place-matching');
const { loadBatchPlaceCatalogue } =
  await import('../src/server/repositories/batch-place-catalogue');
const { processPlaceMatching, PLACE_MATCHING_BATCH_SIZE } =
  await import('../src/server/application/place-matching');
const repository = createPlaceMatchingRepository();
const catalogue = await repository.catalogue();
type Baseline = {
  activity_id: string;
  user_id: string;
  athlete_id: number;
  generation: string;
  revision: string;
  source_version: string;
  result: ActivityPlacesResponse;
  map_bbox: number[] | null;
  start_latlng: number[] | null;
};
const rows = (
  await db.execute<Baseline>(sql`
  SELECT a.id::text AS activity_id,u.id AS user_id,u.athlete_id,s.generation,s.revision::text,s.source_version,c.result,a.map_bbox,a.start_latlng
  FROM activities a JOIN "user" u ON u.athlete_id=a.athlete JOIN activity_streams s ON s.activity_id=a.id
  JOIN activity_place_checks c ON c.activity_id=a.id AND c.recipe_hash=${MATCHING_RECIPE_HASH}
  WHERE a.athlete=${Number(values.athlete)} AND c.user_id=u.id AND c.result IS NOT NULL
    ${values.activity ? sql`AND a.id=${values.activity}::bigint` : sql``}
    AND c.stream_generation=s.generation AND c.stream_revision=s.revision AND c.source_version=s.source_version
    AND c.catalogue_snapshot_id=${catalogue.snapshotId} AND c.catalogue_revision=${catalogue.revision}::bigint
    AND s.invalidated_at IS NULL AND s.source_version=md5(activity_stream_source(a)::text)
    AND EXISTS (SELECT 1 FROM account x WHERE x."userId"=u.id AND x."providerId"='strava' AND x."accountId"=u.athlete_id::text AND x.revoked_at IS NULL AND x.scheduled_erasure_at IS NULL)
  ORDER BY a.id
`)
).rows;
if (!rows.length)
  throw new Error(
    'No current persisted baseline checks; populate the local matching cache first',
  );
const selected =
  limit && limit < rows.length
    ? Array.from(
        { length: limit },
        (_, i) => rows[Math.floor((i * rows.length) / limit)]!,
      )
    : rows;
const expected = new Map(selected.map((row) => [row.activity_id, row.result]));
const candidates: MatchingCandidate[] = selected.map((row) => ({
  activityId: row.activity_id,
  userId: row.user_id,
  athleteId: row.athlete_id,
  generation: row.generation,
  revision: row.revision,
  sourceVersion: row.source_version,
  locationHint: { bounds: row.map_bbox, start: row.start_latlng },
}));
const groupSizes: number[] = [],
  windows: number[] = [],
  groupBytes: number[] = [],
  loadsMs: number[] = [];
const count = (
  await db.execute<{ count: number }>(
    sql`SELECT count(*)::integer AS count FROM places WHERE retired_at IS NULL AND catalogue_snapshot_id=${catalogue.snapshotId}`,
  )
).rows[0]!.count;
let verified = 0;
const remaining = new Map(
  candidates.map((candidate) => [candidate.activityId, candidate]),
);
const uniquePlaces = new Set<string>();
const activitiesPerGroup: number[] = [];
let pendingReads = 0;
const started = performance.now(),
  cpu = process.cpuUsage();
while (verified < candidates.length) {
  const result = await processPlaceMatching({
    repository: {
      ...repository,
      acquire: async () => 'read-only-comparison',
      release: async () => undefined,
      candidates: async (_catalogue, limit) =>
        [...remaining.values()].slice(0, limit),
      readInputs: async (candidates, budget, sizeCache) => {
        const result = await repository.readInputs(
          candidates,
          budget,
          sizeCache,
        );
        pendingReads += result.consumed;
        return result;
      },
      commitMany: async (_token, version, writes) => {
        assert.deepEqual(version, catalogue, 'Catalogue changed');
        for (const { candidate, response } of writes) {
          assert(response, 'Regional run failed instead of matching');
          assert.deepEqual(
            response,
            expected.get(candidate.activityId),
            `Regional result differs for activity ${candidate.activityId}`,
          );
          assert(
            // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
            remaining.delete(candidate.activityId),
            'Candidate matched more than once',
          );
        }
        return {
          committed: writes.map((write) => write.candidate.activityId),
          fenceLost: false,
        };
      },
    },
    loadSnapshot: async (selection) => {
      const before = performance.now();
      const snapshot = await loadBatchPlaceCatalogue(undefined, selection);
      for (const place of snapshot.places) uniquePlaces.add(place.id);
      activitiesPerGroup.push(pendingReads);
      pendingReads = 0;
      loadsMs.push(performance.now() - before);
      groupSizes.push(snapshot.places.length);
      windows.push(selection.windows.length);
      groupBytes.push(Buffer.byteLength(JSON.stringify(snapshot.places)));
      return snapshot;
    },
  });
  assert.equal(result.failed, 0);
  assert.equal(result.superseded, 0);
  assert(['complete', 'batch_limit', 'deadline'].includes(result.stopReason));
  assert(result.saved > 0, 'No benchmark progress');
  verified += result.saved;
  console.log(
    JSON.stringify({
      verified,
      total: candidates.length,
      groups: groupSizes.length,
    }),
  );
}
assert.deepEqual(
  await repository.catalogue(),
  catalogue,
  'Catalogue changed during comparison',
);
const used = process.cpuUsage(cpu),
  totalPlaces = groupSizes.reduce((a, b) => a + b, 0);
const report = {
  measuredAt: new Date().toISOString(),
  activities: verified,
  cataloguePlaces: count,
  groups: groupSizes.length,
  placeRowsTransferred: totalPlaces,
  distinctPlacesTransferred: uniquePlaces.size,
  repeatedPlaceRowsAcrossGroups: totalPlaces - uniquePlaces.size,
  maxActivitiesPerGroup: Math.max(...activitiesPerGroup),
  averageActivitiesPerGroup:
    activitiesPerGroup.reduce((a, b) => a + b, 0) / activitiesPerGroup.length,
  fullCatalogueRowsForSameGroups: count * groupSizes.length,
  defaultBatchActivities: PLACE_MATCHING_BATCH_SIZE,
  fullCatalogueRowsAtDefaultBatchSize:
    count * Math.ceil(candidates.length / PLACE_MATCHING_BATCH_SIZE),
  rowReductionFraction:
    1 -
    totalPlaces /
      (count * Math.ceil(candidates.length / PLACE_MATCHING_BATCH_SIZE)),
  minPlacesPerGroup: Math.min(...groupSizes),
  maxPlacesPerGroup: Math.max(...groupSizes),
  averagePlacesPerGroup: totalPlaces / groupSizes.length,
  matchingFieldsJsonBytes: groupBytes.reduce((a, b) => a + b, 0),
  queryWindows: windows.reduce((a, b) => a + b, 0),
  catalogueLoadMs: loadsMs.reduce((a, b) => a + b, 0),
  wallSeconds: (performance.now() - started) / 1000,
  applicationCpuSeconds: (used.user + used.system) / 1e6,
  peakProcessRssMiB: process.resourceUsage().maxRSS / 1024,
  scope:
    'Read-only regional worker comparison against current persisted checks. No lease/check writes or Strava calls. JSON bytes estimate minimal matching fields, not protocol wire bytes.',
};
await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(0);
