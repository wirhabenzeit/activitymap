import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { connect } from 'node:net';

import { Pool, neonConfig } from '@neondatabase/serverless';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-serverless';
import postgres from 'postgres';
import ws, { WebSocketServer, createWebSocketStream } from 'ws';

import { createBatchActivityPlaceMatcher } from '../../src/server/application/batch-activity-places';
import {
  ActivityPlacesInputChangedError,
  ActivityPlacesUnavailableError,
} from '../../src/server/application/match-activity-places';
import { processPlaceMatching } from '../../src/server/application/place-matching';
import type { Actor } from '../../src/server/auth/actor';
import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling';
import * as schema from '../../src/server/db/schema';
import { refreshCatalogue } from '../../src/server/places/catalogue-refresh';
import { createSyntheticCatalogue } from '../../src/server/places/catalogue.fixture';
import {
  MATCHING_RECIPE_HASH,
  SERVER_MATCHER_POLICY,
  matchingVersion,
} from '../../src/server/places/matching-version';
import { placeQueryWindows } from '../../src/server/places/query-windows';
import { prepareTrack } from '../../src/server/places/track-sections';
import { loadBatchPlaceCatalogue } from '../../src/server/repositories/batch-place-catalogue';
import { createChangesRepository } from '../../src/server/repositories/changes';
import { createPlaceMatchingRepository } from '../../src/server/repositories/place-matching';

const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
)
  throw new Error(
    'Persisted matching proofs require a guarded local *_test database',
  );
const client = postgres(target.connectionString, {
  max: 2,
  prepare: false,
  onnotice: () => undefined,
});
await verifyConnectedTarget(client, target);
const proxy = new WebSocketServer({ host: '127.0.0.1', port: 0 });
proxy.on('connection', (socket) => {
  const upstream = connect({
    host: target.hostname,
    port: Number(new URL(target.connectionString).port || 5432),
  });
  const downstream = createWebSocketStream(socket);
  upstream.on('error', () => downstream.destroy());
  downstream.on('error', () => upstream.destroy());
  downstream.on('close', () => upstream.destroy());
  upstream.on('close', () => downstream.destroy());
  downstream.pipe(upstream).pipe(downstream);
});
await once(proxy, 'listening');
const address = proxy.address();
assert(address && typeof address !== 'string');
neonConfig.webSocketConstructor = ws;
neonConfig.useSecureWebSocket = false;
neonConfig.forceDisablePgSSL = true;
neonConfig.pipelineConnect = false;
neonConfig.wsProxy = () => `127.0.0.1:${address.port}/v2`;
const pool = new Pool({ connectionString: target.connectionString, max: 2 });
const database = drizzle({ client: pool, schema });
const actor: Actor = {
  userId: `on-demand-${randomUUID()}`,
  athleteId: 9345001,
  authentication: 'cookie',
};
const other: Actor = {
  userId: `on-demand-other-${randomUUID()}`,
  athleteId: 9345002,
  authentication: 'bearer',
};
const id = '9007199254740993';
const catalogue = createSyntheticCatalogue({ regionId: 'ch-at-it' });
const peak = catalogue.rows[0]!;
const stream = (type: string, data: number[] | number[][]) => ({
  type,
  data,
  resolution: 'high' as const,
  series_type: 'time' as const,
  original_size: 3,
});
const payload = {
  latlng: stream(
    'latlng',
    [-0.0002, 0, 0.0002].map((offset) => [
      peak.location.latitude,
      peak.location.longitude + offset,
    ]),
  ),
  time: stream('time', [0, 20, 40]),
  distance: stream('distance', [0, 20, 40]),
  altitude: stream('altitude', [1235, 1235, 1235]),
};
const repository = createPlaceMatchingRepository(database);
async function resetStreams() {
  await client`DELETE FROM activity_streams WHERE activity_id=${id}::bigint`;
  await client`INSERT INTO activity_streams(activity_id,generation,revision,requested_types,available_types,payload,source_version,fetched_at,last_attempt_at,last_attempt_status)
    SELECT id, ${randomUUID()}, 1, ARRAY['latlng','time','distance','altitude'], ARRAY['latlng','time','distance','altitude'], ${JSON.stringify(payload)}::jsonb, md5(activity_stream_source(a)::text), now(),now(),'succeeded' FROM activities a WHERE id=${id}::bigint`;
}
const run = (limit = 500) =>
  processPlaceMatching({
    activityLimit: limit,
    repository,
    loadSnapshot: (selection) => loadBatchPlaceCatalogue(database, selection),
  });
async function evaluation() {
  const catalogue = await repository.catalogue();
  const candidate = (await repository.candidates(catalogue, 1))[0];
  assert(candidate);
  const input = await repository.readInput(candidate);
  assert(input);
  const snapshot = await loadBatchPlaceCatalogue(database);
  const response = await createBatchActivityPlaceMatcher({
    snapshot,
    policy: SERVER_MATCHER_POLICY,
  }).match({
    userId: candidate.userId,
    activityId: candidate.activityId,
    input,
  });
  return { catalogue, candidate, response };
}
let imported = false;
try {
  assert.equal(
    (await client`SELECT count(*)::int AS count FROM places`)[0]?.count,
    0,
    'Require an empty test catalogue',
  );
  await refreshCatalogue(client, catalogue, {
    regionId: 'ch-at-it',
    dryRun: false,
    expectedCurrentSnapshot: null,
  });
  imported = true;
  await database.insert(schema.users).values([
    { id: actor.userId, athlete_id: actor.athleteId },
    { id: other.userId, athlete_id: other.athleteId },
  ]);
  await database.insert(schema.accounts).values(
    [actor, other].map((owner) => ({
      id: owner.userId,
      userId: owner.userId,
      providerId: 'strava',
      accountId: String(owner.athleteId),
      accessToken: 'synthetic-test-token',
    })),
  );
  await database.insert(schema.activities).values({
    id: sql`${id}::bigint`,
    athlete: actor.athleteId,
    public_id: 9345001,
    name: 'Persisted matching proof',
    sport_type: 'Hike',
    start_date: new Date('2026-10-20T10:00:00Z'),
    start_date_local: new Date('2026-10-20T10:00:00Z'),
    timezone: 'UTC',
    geometryState: 'summary',
    map_bbox: [
      peak.location.longitude - 0.0002,
      peak.location.latitude,
      peak.location.longitude + 0.0002,
      peak.location.latitude,
    ],
    start_latlng: [peak.location.latitude, peak.location.longitude - 0.0002],
  });
  assert.equal((await repository.read(actor, id)).status, 'missing_streams');
  await resetStreams();
  const scheduledCandidate = (
    await repository.candidates(await repository.catalogue(), 1)
  )[0];
  assert.deepEqual(
    scheduledCandidate?.locationHint,
    {
      bounds: [
        peak.location.longitude - 0.0002,
        peak.location.latitude,
        peak.location.longitude + 0.0002,
        peak.location.latitude,
      ],
      start: [peak.location.latitude, peak.location.longitude - 0.0002],
    },
    'Spatial scheduling gets lightweight summary hints without loading GPS payloads',
  );
  const track = prepareTrack(payload, SERVER_MATCHER_POLICY);
  const windows = placeQueryWindows(
    track.geometry,
    SERVER_MATCHER_POLICY.discoveryRadiusM,
  );
  const scoped = await loadBatchPlaceCatalogue(database, {
    windows: [...windows, ...windows],
  });
  assert.equal(
    scoped.places.length,
    1,
    'Single-activity queries fetch only nearby places and deduplicate overlapping windows',
  );
  const full = await loadBatchPlaceCatalogue(database);
  assert.equal(full.places.length, 3);
  const hutId = full.places.find((place) => place.kinds.includes('hut'))!.id;
  await client`UPDATE places SET retired_at=now() WHERE id=${hutId}::uuid`;
  await assert.rejects(
    loadBatchPlaceCatalogue(database, { windows }),
    /Incomplete batch catalogue/,
    'Scoped reads must still detect an incomplete published catalogue',
  );
  await client`UPDATE places SET retired_at=NULL WHERE id=${hutId}::uuid`;
  assert.equal(
    (await loadBatchPlaceCatalogue(database, { windows: [] })).places.length,
    0,
    'An empty GPS scope loads no place rows',
  );
  const hut = catalogue.rows[2]!;
  const hutWindows = placeQueryWindows(
    {
      type: 'GeometryCollection',
      geometries: [
        {
          type: 'Point',
          coordinates: [hut.location.longitude, hut.location.latitude],
        },
      ],
    },
    300,
  );
  const separated = await loadBatchPlaceCatalogue(database, {
    windows: [...windows, ...hutWindows],
  });
  assert.equal(
    separated.places.length,
    2,
    'Separate activity windows exclude places in the space between them',
  );
  const data = {
    userId: actor.userId,
    activityId: id,
    input: { payload, generation: 'g', revision: '1' },
  };
  assert.deepEqual(
    await createBatchActivityPlaceMatcher({
      snapshot: scoped,
      policy: SERVER_MATCHER_POLICY,
    }).match(data),
    await createBatchActivityPlaceMatcher({
      snapshot: full,
      policy: SERVER_MATCHER_POLICY,
    }).match(data),
  );
  assert.equal((await repository.read(actor, id)).status, 'pending');
  await assert.rejects(
    repository.read(other, id),
    ActivityPlacesUnavailableError,
  );
  const changes = createChangesRepository(database);
  const beforeMatch = await changes.latestSequence(actor.athleteId);
  assert.equal((await run()).saved, 1);
  const events = await changes.findAfter(actor.athleteId, beforeMatch);
  assert.equal(
    events.length,
    1,
    'A committed matching result publishes exactly one activity event',
  );
  assert.equal(events[0]?.entityType, 'activity');
  assert.equal(events[0]?.entityId, id);
  const synced = await repository.sync(actor, [id, '123']);
  assert.equal(synced.results.size, 1);
  assert.equal(synced.results.get(id)?.places.length, 1);
  assert.equal(synced.results.get(id)?.matchingVersion, synced.version);
  assert.equal(
    (await repository.sync(other, [id])).results.size,
    0,
    'Bulk sync cannot disclose another athlete',
  );
  const first = await repository.read(actor, id);
  assert.equal(first.status, 'complete');
  assert.equal(first.places.length, 1);
  assert(first.resultRevision);
  assert.equal((await run()).selected, 0, 'Fresh checks are skipped');
  assert.equal(
    (await repository.read(actor, id)).resultRevision,
    first.resultRevision,
  );

  // A failed feed insert rolls the matching check back in the same transaction.
  const beforeFailure = await repository.read(actor, id);
  await resetStreams();
  const failedInput = await evaluation();
  const failToken = await repository.acquire();
  assert(failToken);
  const feedBeforeFailure = await changes.latestSequence(actor.athleteId);
  await client.unsafe(
    `CREATE FUNCTION test_reject_matching_feed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected matching feed failure'; END $$`,
  );
  await client.unsafe(
    `CREATE TRIGGER test_reject_matching_feed BEFORE INSERT ON sync_change FOR EACH ROW EXECUTE FUNCTION test_reject_matching_feed()`,
  );
  try {
    await assert.rejects(
      repository.commit(
        failToken,
        failedInput.catalogue,
        failedInput.candidate,
        failedInput.response,
      ),
      /Failed query|injected matching feed failure/,
    );
    assert.equal(
      (
        await client`SELECT result_revision::text FROM activity_place_checks WHERE activity_id=${id}::bigint AND recipe_hash=${MATCHING_RECIPE_HASH}`
      )[0]?.result_revision,
      beforeFailure.resultRevision,
    );
    assert.equal(
      await changes.latestSequence(actor.athleteId),
      feedBeforeFailure,
    );
  } finally {
    await client.unsafe(
      'DROP TRIGGER test_reject_matching_feed ON sync_change',
    );
    await client.unsafe('DROP FUNCTION test_reject_matching_feed()');
    await repository.release(failToken);
  }
  await run();

  // A zero-visit completed check must be durable, not rediscovered forever.
  await client`UPDATE activity_streams SET payload=jsonb_set(payload,'{altitude,data}','[3000,3000,3000]'::jsonb),revision=revision+1 WHERE activity_id=${id}::bigint`;
  assert.equal((await repository.read(actor, id)).status, 'pending');
  assert.equal((await run()).saved, 1);
  assert.equal((await repository.read(actor, id)).places.length, 0);
  assert.deepEqual(
    (await repository.sync(actor, [id])).results.get(id)?.places,
    [],
    'Zeroes replace prior visits in sync',
  );
  assert.equal((await run()).selected, 0);

  // Stream invalidation is local, whereas one catalogue write invalidates both.
  const secondId = '9007199254740995';
  await database.insert(schema.activities).values({
    id: sql`${secondId}::bigint`,
    athlete: other.athleteId,
    public_id: 9345002,
    name: 'Other matching proof',
    sport_type: 'Hike',
    start_date: new Date('2026-10-20T10:00:00Z'),
    start_date_local: new Date('2026-10-20T10:00:00Z'),
    timezone: 'UTC',
    geometryState: 'summary',
  });
  await client`INSERT INTO activity_streams(activity_id,generation,revision,requested_types,available_types,payload,source_version,fetched_at,last_attempt_at,last_attempt_status)
    SELECT a.id,${randomUUID()},1,ARRAY['latlng','time','distance','altitude'],ARRAY['latlng','time','distance','altitude'],${JSON.stringify(payload)}::jsonb,md5(activity_stream_source(a)::text),now(),now(),'succeeded' FROM activities a WHERE id=${secondId}::bigint`;
  assert.equal((await run()).saved, 1);
  await client`UPDATE activity_streams SET revision=revision+1 WHERE activity_id=${id}::bigint`;
  assert.deepEqual(
    (await repository.candidates(await repository.catalogue(), 500)).map(
      (c) => c.activityId,
    ),
    [id],
  );
  await run();
  await client`UPDATE places SET location=location WHERE id=(SELECT id FROM places LIMIT 1)`;
  assert.equal(
    (await repository.candidates(await repository.catalogue(), 500)).length,
    2,
  );
  assert.equal((await run()).saved, 2);
  await client`DELETE FROM activities WHERE id=${secondId}::bigint`;
  await client`UPDATE activities SET distance=COALESCE(distance,0)+1 WHERE id=${id}::bigint`;
  assert.equal(
    (await repository.read(actor, id)).status,
    'missing_streams',
    'Source edits hide stale matches until fresh streams arrive',
  );
  assert.equal((await run()).selected, 0);
  await resetStreams();
  await run();

  // Concurrent matching and activity writers cannot commit a later sequence
  // before an earlier allocation for the same athlete becomes visible.
  let releaseWriter!: () => void;
  let writerReady!: () => void;
  const releaseGate = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    writerReady = resolve;
  });
  const firstWriter = database.transaction(async (tx) => {
    const rows = await changes.record(
      [
        {
          athleteId: actor.athleteId,
          entityType: 'activity',
          entityId: id,
          operation: 'upsert',
        },
      ],
      tx,
    );
    writerReady();
    await releaseGate;
    return rows;
  });
  await ready;
  let secondCommitted = false;
  const highWater = await changes.latestSequence(actor.athleteId);
  const secondWriter = database
    .transaction(async (tx) => {
      const rows = await changes.record(
        [
          {
            athleteId: actor.athleteId,
            entityType: 'activity',
            entityId: id,
            operation: 'upsert',
          },
        ],
        tx,
      );
      return rows;
    })
    .then((rows) => {
      secondCommitted = true;
      return rows;
    });
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      waiting =
        (
          await client`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory') AS waiting`
        )[0]?.waiting === true;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(waiting, 'The second writer waits before allocating its sequence');
    assert.equal(secondCommitted, false);
    assert.equal(
      (
        await client`SELECT max(sequence)::text AS sequence FROM sync_change WHERE athlete_id=${actor.athleteId}`
      )[0]?.sequence,
      String(highWater),
    );
  } finally {
    releaseWriter();
  }
  const [firstEvents, secondEvents] = await Promise.all([
    firstWriter,
    secondWriter,
  ]);
  assert(firstEvents[0]!.sequence < secondEvents[0]!.sequence);
  assert.equal((await changes.findAfter(actor.athleteId, highWater)).length, 2);

  // Algorithm/discovery/settings identity changes invalidate all prior recipes.
  await client`UPDATE activity_place_checks SET recipe_hash=${'f'.repeat(64)} WHERE activity_id=${id}::bigint`;
  assert.equal((await repository.read(actor, id)).status, 'pending');
  assert.equal((await run()).saved, 1);
  assert.equal(
    (
      await client`SELECT count(*)::int AS count FROM activity_place_checks WHERE activity_id=${id}::bigint`
    )[0]?.count,
    2,
    'Recipes coexist during rolling deployments',
  );

  // Direct place corrections change the epoch, even without a new manifest.
  const beforeVersion = await repository.version(actor);
  await client`UPDATE places SET display_name=display_name || ' corrected' WHERE id=(SELECT id FROM places ORDER BY id LIMIT 1)`;
  assert.notDeepEqual(await repository.version(actor), beforeVersion);
  const invalidatedSync = await repository.sync(actor, [id]);
  assert.notEqual(invalidatedSync.version, beforeVersion.version);
  assert.equal(invalidatedSync.results.get(id)?.status, 'pending');
  assert.equal(
    (await repository.sync(actor, [])).version,
    invalidatedSync.version,
    'Even empty sync pages carry the current version',
  );
  assert.equal((await repository.read(actor, id)).status, 'pending');
  assert.equal((await run()).saved, 1);
  const beforeNoop = await repository.catalogue();
  // Exact no-op publication needs the unchanged synthetic rows, so restore them
  // by publication first, then publish the identical snapshot again.
  await refreshCatalogue(client, catalogue, {
    regionId: 'ch-at-it',
    dryRun: false,
    expectedCurrentSnapshot: catalogue.manifest.catalogue_snapshot_id,
  });
  await run();
  const settled = await repository.catalogue();
  await refreshCatalogue(client, catalogue, {
    regionId: 'ch-at-it',
    dryRun: false,
    expectedCurrentSnapshot: catalogue.manifest.catalogue_snapshot_id,
  });
  assert.deepEqual(
    await repository.catalogue(),
    settled,
    'Identical publication does not invalidate',
  );
  assert.notEqual(beforeNoop.revision, settled.revision);

  // A publisher or stream writer winning during computation fences the commit.
  await resetStreams();
  for (const change of [
    () =>
      client`UPDATE activity_streams SET revision=revision+1 WHERE activity_id=${id}::bigint`,
    () =>
      client`UPDATE places SET display_name=display_name WHERE id=(SELECT id FROM places LIMIT 1)`,
    () => client`UPDATE account SET revoked_at=now() WHERE id=${actor.userId}`,
    () =>
      client`UPDATE account SET scheduled_erasure_at=now() WHERE id=${actor.userId}`,
  ]) {
    await resetStreams();
    const evaluated = await evaluation();
    const token = await repository.acquire();
    assert(token);
    await change();
    assert.equal(
      await repository.commit(
        token,
        evaluated.catalogue,
        evaluated.candidate,
        evaluated.response,
      ),
      false,
    );
    await repository.release(token);
    await client`UPDATE account SET revoked_at=NULL,scheduled_erasure_at=NULL WHERE id=${actor.userId}`;
  }
  // Revoked accounts cannot read persisted matches or get selected for work.
  await run();
  await client`UPDATE account SET revoked_at=now() WHERE id=${actor.userId}`;
  await assert.rejects(
    repository.read(actor, id),
    ActivityPlacesUnavailableError,
  );
  assert.equal(
    (await repository.sync(actor, [id])).results.size,
    0,
    'Revoked accounts cannot sync private results',
  );
  assert.equal(
    (await repository.candidates(await repository.catalogue(), 500)).length,
    0,
  );
  await client`UPDATE account SET revoked_at=NULL WHERE id=${actor.userId}`;

  // Expired leases are recoverable and cannot release/commit for their successor.
  await resetStreams();
  const evaluated = await evaluation();
  const old = await repository.acquire();
  assert(old);
  assert.equal(await repository.acquire(), null);
  await client`UPDATE place_matching_lease SET expires_at=now()-interval '1 second' WHERE token=${old}::uuid`;
  const replacement = await repository.acquire();
  assert(replacement);
  await repository.release(old);
  assert.equal(await repository.acquire(), null);
  assert.equal(
    await repository.commit(
      old,
      evaluated.catalogue,
      evaluated.candidate,
      evaluated.response,
    ),
    false,
  );
  assert.equal(
    await repository.commit(
      replacement,
      evaluated.catalogue,
      evaluated.candidate,
      null,
    ),
    true,
  );
  await repository.release(replacement);
  assert.equal(
    (await repository.candidates(evaluated.catalogue, 500)).length,
    0,
    'Failed checks back off',
  );
  await client`UPDATE places SET display_name=display_name WHERE id=(SELECT id FROM places LIMIT 1)`;
  assert.equal(
    (await repository.candidates(await repository.catalogue(), 500)).length,
    1,
    'New input versions bypass old failure backoff',
  );
  await run();

  // A worker finishing between the two private reads must not turn a pending
  // response into a permanent client error for unchanged inputs.
  const completedResult: unknown = (
    await client`SELECT result FROM activity_place_checks WHERE activity_id=${id}::bigint AND recipe_hash=${MATCHING_RECIPE_HASH}`
  )[0]?.result;
  assert(completedResult);
  await client`UPDATE activity_place_checks SET result=NULL WHERE activity_id=${id}::bigint AND recipe_hash=${MATCHING_RECIPE_HASH}`;
  const completing = new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'transaction')
        return async (...args: Parameters<typeof database.transaction>) => {
          const result = await target.transaction(...args);
          await client`UPDATE activity_place_checks SET result=${JSON.stringify(completedResult)}::jsonb,result_revision=gen_random_uuid() WHERE activity_id=${id}::bigint AND recipe_hash=${MATCHING_RECIPE_HASH}`;
          return result;
        };
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  assert.equal(
    (await createPlaceMatchingRepository(completing).read(actor, id)).status,
    'pending',
  );
  assert.equal((await repository.read(actor, id)).status, 'complete');

  // Fence a private response when metadata changes after its read snapshot.
  const wrapped = new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'transaction')
        return async (...args: Parameters<typeof database.transaction>) => {
          const result = await target.transaction(...args);
          await client`UPDATE activity_streams SET revision=revision+1 WHERE activity_id=${id}::bigint`;
          return result;
        };
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  await assert.rejects(
    createPlaceMatchingRepository(wrapped).read(actor, id),
    ActivityPlacesInputChangedError,
  );
  await run();
  const check = await repository.read(actor, id);
  assert.equal(
    check.matchingVersion,
    matchingVersion(await repository.catalogue()),
  );
  // Delete/recreate with the same provider ID cannot admit an old generation.
  await resetStreams();
  const late = await evaluation();
  const token = await repository.acquire();
  assert(token);
  await client`DELETE FROM activities WHERE id=${id}::bigint`;
  assert.equal(
    await repository.commit(
      token,
      late.catalogue,
      late.candidate,
      late.response,
    ),
    false,
  );
  await repository.release(token);
  assert.equal(
    (
      await client`SELECT count(*)::int AS count FROM activity_place_checks WHERE activity_id=${id}::bigint`
    )[0]?.count,
    0,
  );
  console.log(
    'PASS persisted matching and sync: atomic check/feed commits and rollback, concurrent sequence ordering, scoped bundles, zero replacements, global manifests, recipe versions, catalogue/manual invalidation, no-op publication, private reads, stale commits, leases, retry backoff and deletion cascades.',
  );
} finally {
  await database
    .delete(schema.users)
    .where(inArray(schema.users.id, [actor.userId, other.userId]));
  if (imported) {
    await database
      .delete(schema.places)
      .where(
        eq(
          schema.places.catalogueSnapshotId,
          catalogue.manifest.catalogue_snapshot_id,
        ),
      );
    await database
      .delete(schema.placeCatalogues)
      .where(
        eq(
          schema.placeCatalogues.snapshotId,
          catalogue.manifest.catalogue_snapshot_id,
        ),
      );
  }
  await client`DELETE FROM place_matching_lease WHERE key='activity-place-matching'`;
  await pool.end();
  await client.end();
  proxy.close();
}
