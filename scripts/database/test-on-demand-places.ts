import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { connect } from 'node:net';

import { Pool, neonConfig } from '@neondatabase/serverless';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-serverless';
import postgres from 'postgres';
import ws, { WebSocketServer, createWebSocketStream } from 'ws';

import { createActivityPlacesHandler } from '../../src/app/api/activities/[id]/places/handler';
import { createPlaceDebugHandler } from '../../src/app/api/debug/places/handler';
import { activityPlacesResponseSchema } from '../../src/contracts/activity-places';
import {
  DEFAULT_PLACE_DEBUG_SETTINGS,
  placeDebugResponseSchema,
} from '../../src/contracts/place-debug';
import type { Actor } from '../../src/server/auth/actor';
import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling';
import * as schema from '../../src/server/db/schema';
import { refreshCatalogue } from '../../src/server/places/catalogue-refresh';
import { createSyntheticCatalogue } from '../../src/server/places/catalogue.fixture';
import { createOnDemandPlacesRepository } from '../../src/server/repositories/on-demand-places';

const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
)
  throw new Error(
    'On-demand matching proofs require a guarded local *_test database',
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
const previousAdminAllowlist = process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS;
process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS = `${actor.athleteId},${other.athleteId}`;
const repository = createOnDemandPlacesRepository(database);
const debugRequest = () =>
  new Request(`http://localhost/api/activities/${id}/places/debug`, {
    method: 'POST',
    body: JSON.stringify(DEFAULT_PLACE_DEBUG_SETTINGS),
  });
const debugHandle = (current: Actor, debug = repository.debug) =>
  createPlaceDebugHandler({ resolveActor: async () => current, debug });
const request = () =>
  new Request(`http://localhost/api/activities/${id}/places`);
const handle = (current: Actor, read = repository.match) =>
  createActivityPlacesHandler({ resolveActor: async () => current, read });
let imported = false;
async function resetStreams() {
  await client`DELETE FROM activity_streams WHERE activity_id=${id}::bigint`;
  await client`INSERT INTO activity_streams(activity_id,generation,revision,requested_types,available_types,payload,source_version,fetched_at,last_attempt_at,last_attempt_status)
    SELECT id, 'proof-generation', 1, ARRAY['latlng','time','distance','altitude'], ARRAY['latlng','time','distance','altitude'], ${JSON.stringify(payload)}::jsonb, md5(activity_stream_source(a)::text), now(),now(),'succeeded' FROM activities a WHERE id=${id}::bigint`;
}
async function fingerprints() {
  const result: Record<string, unknown> = {};
  for (const table of [
    'user',
    'account',
    'activities',
    'activity_streams',
    'activity_places',
    'places',
    'place_catalogues',
  ])
    result[table] = [
      ...(await client.unsafe(
        `SELECT count(*)::integer AS count, md5(COALESCE(string_agg(digest,'' ORDER BY digest),'')) AS digest FROM (SELECT md5(to_jsonb(t)::text) AS digest FROM "${table}" t) hashes`,
      )),
    ];
  return result;
}
function racingRepository(change: () => Promise<unknown>) {
  const wrapped = new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'transaction')
        return async (...args: Parameters<typeof database.transaction>) => {
          const result = await target.transaction(...args);
          await change();
          return result;
        };
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return createOnDemandPlacesRepository(wrapped);
}
const racing = (change: () => Promise<unknown>) =>
  racingRepository(change).match;
try {
  assert.equal(
    (await client`SELECT count(*)::integer AS count FROM places`)[0]?.count,
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
    [actor, other].map((current) => ({
      id: current.userId,
      userId: current.userId,
      providerId: 'strava',
      accountId: String(current.athleteId),
      accessToken: 'synthetic-test-token',
    })),
  );
  await database.insert(schema.activities).values({
    id: sql`${id}::bigint`,
    athlete: actor.athleteId,
    public_id: 9345001,
    name: 'On-demand proof',
    sport_type: 'Hike',
    start_date: new Date('2026-10-20T10:00:00Z'),
    start_date_local: new Date('2026-10-20T10:00:00Z'),
    timezone: 'UTC',
    geometryState: 'summary',
  });
  assert.equal((await handle(actor)(request(), id)).status, 200);
  assert.equal((await repository.match(actor, id)).status, 'missing_streams');
  await resetStreams();
  const before = await fingerprints();
  const response = await handle(actor)(request(), id);
  assert.equal(response.status, 200);
  const result = activityPlacesResponseSchema.parse(await response.json());
  assert.equal(result.status, 'complete');
  assert.equal(result.activityId, id);
  assert.equal(result.places.length, 1);
  const matchedPlace = result.places[0];
  assert(matchedPlace);
  assert.equal(matchedPlace.name, peak.display_name);
  assert.equal(matchedPlace.visits[0]?.distanceM, 20);
  assert.deepEqual(
    await fingerprints(),
    before,
    'Successful matching and HTTP handling must not write data',
  );
  const debugResponse = await debugHandle(actor)(debugRequest(), id);
  assert.equal(debugResponse.status, 200);
  const debugResult = placeDebugResponseSchema.parse(
    await debugResponse.json(),
  );
  assert.equal(debugResult.status, 'complete');
  assert.equal(
    debugResult.candidates.filter((p) => p.status === 'matched').length,
    1,
  );
  assert.deepEqual(
    await fingerprints(),
    before,
    'Debug matching must never write data',
  );
  assert.equal((await debugHandle(other)(debugRequest(), id)).status, 404);
  assert.equal((await handle(other)(request(), id)).status, 404);
  for (const update of [
    { revokedAt: new Date() },
    { scheduledErasureAt: new Date() },
    { accessToken: null },
  ]) {
    await database
      .update(schema.accounts)
      .set(update)
      .where(eq(schema.accounts.id, actor.userId));
    assert.equal((await handle(actor)(request(), id)).status, 404);
    assert.equal((await debugHandle(actor)(debugRequest(), id)).status, 404);
    await database
      .update(schema.accounts)
      .set({
        revokedAt: null,
        scheduledErasureAt: null,
        accessToken: 'synthetic-test-token',
      })
      .where(eq(schema.accounts.id, actor.userId));
  }
  await client`UPDATE activity_streams SET source_version='superseded' WHERE activity_id=${id}::bigint`;
  assert.equal((await repository.match(actor, id)).status, 'missing_streams');
  await resetStreams();
  await client`UPDATE activity_streams SET invalidated_at=now() WHERE activity_id=${id}::bigint`;
  assert.equal((await repository.match(actor, id)).status, 'missing_streams');
  await resetStreams();
  const revoke = racing(() =>
    database
      .update(schema.accounts)
      .set({ revokedAt: new Date() })
      .where(eq(schema.accounts.id, actor.userId)),
  );
  assert.equal(
    (await handle(actor, revoke)(request(), id)).status,
    404,
    'Revocation during matching fences the response',
  );
  await database
    .update(schema.accounts)
    .set({ revokedAt: null })
    .where(eq(schema.accounts.id, actor.userId));
  const replace = racing(
    () =>
      client`UPDATE activity_streams SET generation='new-generation' WHERE activity_id=${id}::bigint`,
  );
  assert.equal(
    (await handle(actor, replace)(request(), id)).status,
    409,
    'Input replacement during matching fences the response',
  );
  await resetStreams();
  const debugReplace = racingRepository(
    () =>
      client`UPDATE activity_streams SET generation='debug-new-generation' WHERE activity_id=${id}::bigint`,
  ).debug;
  assert.equal(
    (await debugHandle(actor, debugReplace)(debugRequest(), id)).status,
    409,
    'Debug matching fences concurrent stream replacement',
  );
  await resetStreams();
  const debugRevoke = racingRepository(() =>
    database
      .update(schema.accounts)
      .set({ revokedAt: new Date() })
      .where(eq(schema.accounts.id, actor.userId)),
  ).debug;
  assert.equal(
    (await debugHandle(actor, debugRevoke)(debugRequest(), id)).status,
    404,
    'Debug matching fences concurrent revocation',
  );
  await database
    .update(schema.accounts)
    .set({ revokedAt: null })
    .where(eq(schema.accounts.id, actor.userId));
  const gps = {
    ...payload,
    latlng: stream('latlng', [
      [46, 4],
      [46, 4.0001],
      [46, 4.0002],
    ]),
  };
  await client`UPDATE activity_streams SET payload=${JSON.stringify(gps)}::jsonb WHERE activity_id=${id}::bigint`;
  assert.equal((await repository.match(actor, id)).status, 'uncovered');
  await resetStreams();
  const oversized = {
    ...payload,
    latlng: stream(
      'latlng',
      Array.from({ length: 100001 }, () => [46, 8]),
    ),
  };
  await client`UPDATE activity_streams SET payload=${JSON.stringify(oversized)}::jsonb WHERE activity_id=${id}::bigint`;
  assert.equal((await repository.match(actor, id)).status, 'partial');
  assert.equal(
    (await client`SELECT count(*)::integer AS count FROM activity_places`)[0]
      ?.count,
    0,
  );
  console.log(
    'PASS production and debug matching through real Neon WebSocket/Drizzle, private HTTP handlers, lossless IDs, no writes, eligibility, stale inputs, concurrent revocation/replacement, coverage and sample budgets.',
  );
} finally {
  if (previousAdminAllowlist === undefined)
    delete process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS;
  else process.env.ACTIVITYMAP_ADMIN_ATHLETE_IDS = previousAdminAllowlist;
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
  await pool.end();
  await client.end();
  proxy.close();
}
