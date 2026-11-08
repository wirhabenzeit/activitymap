import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { ConvexHttpClient } from 'convex/browser';
import { config, parse } from 'dotenv';

config({ path: '.env.development.local', quiet: true });
config({ path: '.env', quiet: true });
const { resolveDatabaseConnection } =
  await import('../../../../src/server/db/connection.ts');
assert(
  ['localhost', '127.0.0.1', 'db.localtest.me'].includes(
    new URL(resolveDatabaseConnection(process.env).connectionString).hostname,
  ),
  'Local database only',
);
const { db } = await import('../../../../src/server/db/index.ts');
const { sql } = await import('drizzle-orm');
const { currentPlaceStreams } =
  await import('../../../../src/server/repositories/place-matching-input.ts');
const { createPlaceMatchingRepository } =
  await import('../../../../src/server/repositories/place-matching.ts');
const { loadBatchPlaceCatalogue } =
  await import('../../../../src/server/repositories/batch-place-catalogue.ts');
const { processPlaceMatching } =
  await import('../../../../src/server/application/place-matching.ts');
const { createBatchActivityPlaceMatcher } =
  await import('../../../../src/server/application/batch-activity-places.ts');
const { SERVER_MATCHER_POLICY } =
  await import('../../../../src/server/places/matching-version.ts');
const { canonicalJson } =
  await import('../../../../src/server/places/catalogue-artifact.ts');
const hash = (value) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
const directory = new URL('./results/full-library/', import.meta.url);
await mkdir(directory, { recursive: true });
const save = (file, value) =>
  writeFile(new URL(file, directory), JSON.stringify(value, null, 2) + '\n');
const repository = createPlaceMatchingRepository();
const version = await repository.catalogue();
const exportInfo = JSON.parse(
  await readFile(
    new URL('./results/export-summary.json', import.meta.url),
    'utf8',
  ),
);
assert.equal(
  version.snapshotId,
  exportInfo.dataset,
  'Imported Convex catalogue differs',
);
let candidates, groups, baseline;
if (process.argv.includes('--replay-plan')) {
  const plan = JSON.parse(
    await readFile(new URL('plan-private.json', directory), 'utf8'),
  );
  assert.deepEqual(plan.version, version);
  candidates = plan.candidates;
  groups = plan.groups;
  baseline = JSON.parse(
    await readFile(new URL('postgis.json', directory), 'utf8'),
  );
} else {
  const totals = (
    await db.execute(
      sql`SELECT count(*)::integer AS activities FROM activities`,
    )
  ).rows[0];
  const rows = (
    await db.execute(sql`
  SELECT a.id::text AS activity_id,u.id AS user_id,u.athlete_id,
    s.generation,s.revision::text,s.source_version,a.map_bbox,a.start_latlng
  FROM activities a JOIN "user" u ON u.athlete_id=a.athlete JOIN activity_streams s ON s.activity_id=a.id
  WHERE ${currentPlaceStreams} AND EXISTS (
    SELECT 1 FROM account c WHERE c."userId"=u.id AND c."providerId"='strava' AND c."accountId"=u.athlete_id::text
    AND c.revoked_at IS NULL AND c.scheduled_erasure_at IS NULL
    AND (COALESCE(c."accessToken",c.access_token,'')<>'' OR COALESCE(c."refreshToken",c.refresh_token,'')<>''))
  ORDER BY a.id
`)
  ).rows;
  candidates = rows.map((r) => ({
    activityId: r.activity_id,
    userId: r.user_id,
    athleteId: r.athlete_id,
    generation: r.generation,
    revision: r.revision,
    sourceVersion: r.source_version,
    locationHint: { bounds: r.map_bbox, start: r.start_latlng },
  }));
  assert(candidates.length > 0);
  const candidateMap = new Map(candidates.map((c) => [c.activityId, c]));
  groups = [];
  const passes = [];
  const remaining = new Map(candidateMap);
  let activeGroup;
  const baselineStarted = performance.now();
  const statuses = {};
  const baselineCpu = process.cpuUsage();
  while (remaining.size) {
    const result = await processPlaceMatching({
      repository: {
        ...repository,
        acquire: async () => 'read-only-full-library',
        release: async () => undefined,
        candidates: async (_version, limit) =>
          [...remaining.values()].slice(0, limit),
        commitMany: async (_token, currentVersion, writes) => {
          assert.deepEqual(currentVersion, version);
          assert(activeGroup);
          for (const { candidate, response } of writes) {
            assert(response, 'PostGIS worker failed to match');
            assert(
              remaining.delete(candidate.activityId),
              'Duplicate activity',
            );
            activeGroup.activities.push({
              id: candidate.activityId,
              hash: hash(response),
              status: response.status,
            });
            statuses[response.status] = (statuses[response.status] ?? 0) + 1;
          }
          return {
            committed: writes.map((w) => w.candidate.activityId),
            fenceLost: false,
          };
        },
      },
      loadSnapshot: async (selection) => {
        const before = performance.now();
        const snapshot = await loadBatchPlaceCatalogue(undefined, selection);
        assert.equal(
          snapshot.catalogue.manifest.catalogue_snapshot_id,
          version.snapshotId,
        );
        activeGroup = {
          group: groups.length,
          windows: selection.windows,
          pgLoadMs: performance.now() - before,
          candidates: snapshot.places.length,
          candidateHash: hash(
            [...snapshot.places].sort((a, b) => a.id.localeCompare(b.id)),
          ),
          jsonBytes: Buffer.byteLength(JSON.stringify(snapshot.places)),
          activities: [],
        };
        groups.push(activeGroup);
        return snapshot;
      },
    });
    assert.equal(result.failed, 0);
    assert.equal(result.superseded, 0);
    assert(result.saved > 0);
    passes.push(result);
    console.log(
      JSON.stringify({
        phase: 'postgis',
        verified: candidates.length - remaining.size,
        total: candidates.length,
        groups: groups.length,
        stop: result.stopReason,
      }),
    );
  }
  const cpu = process.cpuUsage(baselineCpu);
  baseline = {
    totalActivities: totals.activities,
    eligibleActivities: candidates.length,
    groups: groups.length,
    statuses,
    wallMs: performance.now() - baselineStarted,
    cpuMs: (cpu.user + cpu.system) / 1000,
    passes,
  };
  await save('plan-private.json', { version, candidates, groups });
  await save('postgis.json', baseline);
  assert.deepEqual(await repository.catalogue(), version);
}
if (process.argv.includes('--baseline-only')) {
  console.log(
    JSON.stringify({
      baselineOnly: true,
      activities: candidates.length,
      groups: groups.length,
    }),
  );
  process.exit(0);
}
const candidateMap = new Map(candidates.map((c) => [c.activityId, c]));
// Independently verify the exact rectangle contract against every exported point.
// PostGIS's bbox operator can admit an extra point outside the exact bounds.
// Final response parity still uses the original, unfiltered PostGIS baseline.
const exportedText = await readFile(
  new URL('./results/places.jsonl', import.meta.url),
  'utf8',
);
assert.equal(
  createHash('sha256').update(exportedText).digest('hex'),
  exportInfo.sha256,
);
const exportedPlaces = exportedText
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line).metadata);
for (const group of groups) {
  const exact = exportedPlaces.filter((p) =>
    group.windows.some(
      (b) =>
        p.location.longitude >= b.west &&
        p.location.longitude <= b.east &&
        p.location.latitude >= b.south &&
        p.location.latitude <= b.north,
    ),
  );
  group.rawCandidateHash ??= group.candidateHash;
  group.exactCandidates = exact.length;
  group.candidateHash = hash(exact.sort((a, b) => a.id.localeCompare(b.id)));
}

const secret = parse(
  await readFile(new URL('./.env.benchmark', import.meta.url)),
);
assert(
  secret.CONVEX_DEPLOY_KEY?.startsWith('dev:spotted-fennec-603|'),
  'Key must target the test deployment',
);
const client = new ConvexHttpClient('https://spotted-fennec-603.convex.cloud', {
  logger: false,
});
client.setAdminAuth(secret.CONVEX_DEPLOY_KEY);
const runId = `full-library-${Date.now()}`;
const reports = {
  runId,
  startedAt: new Date().toISOString(),
  deployment: 'spotted-fennec-603',
  baseline,
  dataset: version.snapshotId,
  catalogueCount: exportInfo.count,
  modes: {},
};
await save('summary.json', reports);
for (const mode of ['uncached', 'cache-enabled']) {
  const started = performance.now();
  const results = [];
  let verified = 0;
  for (const group of groups) {
    const item = {
      group: group.group,
      activities: group.activities.length,
      windows: group.windows.length,
      candidates: group.exactCandidates,
      pgCandidates: group.candidates,
      pgLoadMs: group.pgLoadMs,
      pgJsonBytes: group.jsonBytes,
    };
    try {
      const inputStarted = performance.now();
      const selected = group.activities.map((a) => candidateMap.get(a.id));
      const inputs = await repository.readInputs(selected);
      assert.equal(
        inputs.consumed,
        selected.length,
        'Recorded group exceeded input budget',
      );
      assert.equal(inputs.inputs.size, selected.length, 'Inputs changed');
      item.inputReadMs = performance.now() - inputStarted;
      const loadStarted = performance.now();
      const response = await client.action('lab:tiledWindows', {
        dataset: version.snapshotId,
        windows: group.windows,
        nonce:
          mode === 'uncached' ? `${runId}:${group.group}` : `${runId}:shared`,
      });
      item.convexRoundTripMs = performance.now() - loadStarted;
      Object.assign(item, {
        convexServerMs: response.elapsedMs,
        pages: response.pages,
        scanned: response.scanned,
        tiles: response.tiles,
      });
      assert.equal(
        hash([...response.places].sort((a, b) => a.id.localeCompare(b.id))),
        group.candidateHash,
        'Catalogue candidate/metadata parity',
      );
      const catalogue = JSON.parse(
        await readFile(
          new URL('./results/catalogue.json', import.meta.url),
          'utf8',
        ),
      );
      const matchingStarted = performance.now();
      const matcher = createBatchActivityPlaceMatcher({
        snapshot: {
          catalogue,
          places: response.places,
          windows: group.windows,
        },
        policy: SERVER_MATCHER_POLICY,
      });
      for (const expected of group.activities) {
        const c = candidateMap.get(expected.id);
        const response = await matcher.match({
          userId: c.userId,
          activityId: c.activityId,
          input: inputs.inputs.get(c.activityId),
        });
        assert.equal(
          hash(response),
          expected.hash,
          'Complete matching response parity',
        );
        verified++;
      }
      item.matchingMs = performance.now() - matchingStarted;
      item.parity = true;
    } catch (error) {
      item.parity = false;
      item.error = String(error.message).slice(0, 800);
    }
    results.push(item);
    reports.modes[mode] = {
      verified,
      wallMs: performance.now() - started,
      results,
    };
    await save('summary.json', reports);
    if (results.length % 20 === 0 || !item.parity)
      console.log(
        JSON.stringify({
          phase: mode,
          groups: results.length,
          totalGroups: groups.length,
          verified,
          error: item.error,
        }),
      );
  }
  assert.deepEqual(await repository.catalogue(), version);
  console.log(
    JSON.stringify({
      phase: mode,
      complete: true,
      verified,
      total: candidates.length,
      groups: results.length,
    }),
  );
}
client.clearAuth();
process.exit(
  Object.values(reports.modes).every((r) => r.verified === candidates.length)
    ? 0
    : 1,
);
