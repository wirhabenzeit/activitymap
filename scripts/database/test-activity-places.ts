import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { connect } from 'node:net';

import { Pool, neonConfig } from '@neondatabase/serverless';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws, { WebSocketServer, createWebSocketStream } from 'ws';

import { resolveMigrationTarget } from '../../src/server/db/migration-tooling';
import {
  activities,
  activityPlaces,
  places,
  users,
} from '../../src/server/db/schema';
import {
  buildActivityPlaceEvidence,
  parseActivityPlaceEvidence,
} from '../../src/server/places/types';

const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
) {
  throw new Error(
    'Place proofs may only modify a guarded local *_test database',
  );
}

// Exercise the application's actual Neon WebSocket/Drizzle driver against local
// Postgres. The loopback proxy has one fixed target, never a client-chosen host.
const targetUrl = new URL(target.connectionString);
const proxy = new WebSocketServer({ host: '127.0.0.1', port: 0 });
proxy.on('connection', (socket) => {
  const upstream = connect({
    host: target.hostname,
    port: Number(targetUrl.port || 5432),
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
const pool = new Pool({ connectionString: target.connectionString, max: 1 });
const db = drizzle(pool);
const rollback = new Error('Successful proof: roll back all fixtures');
const placeId = randomUUID();
const hutId = randomUUID();
const activityId = 9007199254740993n;
const sourceId = 9007199254740995n;
const now = new Date('2026-10-20T20:23:47Z');
const point = { longitude: 8.123456789, latitude: 46.987654321 };
const evidence = buildActivityPlaceEvidence([
  {
    section_id: 0,
    start_gps_index: 0,
    end_gps_index: 2,
    closest: { kind: 'segment', start_index: 0, end_index: 1, fraction: 0.5 },
    elapsed_s: { start: 0, closest: 5, end: 20 },
    route_distance_m: { basis: 'section_gps', start: 0, closest: 5, end: 20 },
    min_horizontal_distance_m: 0,
    source: { point, mapped_elevation_m: 1234 },
    recorded_altitude_m: 1235,
    altitude_difference_m: 1,
    relation_assessments: [
      {
        relation: 'crossed_pass',
        status: 'supported',
        reason_codes: ['continuous_crossing'],
      },
    ],
    quality_flags: [],
  },
]);

function postgresCode(error: unknown): unknown {
  if (!(error instanceof Error)) return undefined;
  if ('code' in error) return error.code;
  return postgresCode(error.cause);
}

try {
  await db.transaction(async (tx) => {
    const identity = await tx.execute(
      sql`SELECT current_database() AS database`,
    );
    assert.equal(identity.rows[0]?.database, target.database);
    const version = await tx.execute(
      sql`SELECT PostGIS_Lib_Version() AS version`,
    );
    console.log(
      `Local PostGIS ${String(version.rows[0]?.version)}; Neon WebSocket driver`,
    );

    await tx
      .insert(users)
      .values({ id: `places-proof-${placeId}`, athlete_id: 9321001 });
    await tx.insert(activities).values({
      id: sql`${activityId.toString()}::bigint`,
      public_id: 9321001,
      athlete: 9321001,
      name: 'Place schema proof',
      sport_type: 'Hike',
      start_date: now,
      start_date_local: now,
      timezone: 'UTC',
      geometryState: 'summary',
    });
    const source = {
      osmId: sourceId,
      displayName: 'Proof pass',
      names: { name: 'Proof pass', 'name:de': 'Prüfpass' },
      location: point,
      elevationM: 1234,
      tags: {
        name: 'Proof pass',
        natural: 'saddle',
        mountain_pass: 'yes',
        ele: '1234',
      },
      osmVersion: 3,
      osmUpdatedAt: now,
      normalizationVersion: 'places-v1',
      catalogueSnapshotId: 'proof-snapshot',
    };
    await tx.insert(places).values({
      ...source,
      id: placeId,
      osmType: 'node',
      kinds: ['pass'],
      subtypes: ['natural_saddle', 'road_trail_pass'],
      pointDerivation: 'osm_node',
    });
    // OSM identity includes the object type; the same numeric way ID is distinct.
    await tx.insert(places).values({
      ...source,
      id: hutId,
      osmType: 'way',
      kinds: ['hut'],
      subtypes: ['alpine_hut'],
      pointDerivation: 'validated_polygon_interior',
    });
    const [stored] = await tx
      .select()
      .from(places)
      .where(eq(places.id, placeId));
    assert(stored);
    assert.equal(
      stored.osmId,
      sourceId,
      'OSM bigint survives without Number coercion',
    );
    assert.deepEqual(
      stored.location,
      point,
      'longitude/latitude round-trip through PostGIS',
    );
    assert.deepEqual(stored.names, source.names);
    assert.deepEqual(stored.tags, source.tags);
    assert.equal(stored.osmUpdatedAt.toISOString(), now.toISOString());

    const membership = {
      activityId,
      placeId,
      supportedRelations: evidence.supported_relations,
      encounters: evidence.encounters,
      evidenceVersion: evidence.evidence_version,
      inputStreamGeneration: 'proof-generation',
      inputStreamRevision: 2n,
      inputSourceVersion: 'proof-source',
      catalogueSnapshotId: 'proof-snapshot',
      matcherVersion: 'matcher-v1',
      parametersHash: 'a'.repeat(64),
      runId: randomUUID(),
    };
    await tx.insert(activityPlaces).values(membership);
    const [storedEvidence] = await tx
      .select()
      .from(activityPlaces)
      .where(eq(activityPlaces.placeId, placeId));
    assert(storedEvidence);
    assert.equal(
      storedEvidence.activityId,
      activityId,
      'activity bigint survives without Number coercion',
    );
    assert.deepEqual(
      parseActivityPlaceEvidence({
        evidence_version: storedEvidence.evidenceVersion,
        encounters: storedEvidence.encounters,
        supported_relations: storedEvidence.supportedRelations,
      }),
      evidence,
    );

    async function rejects(
      statement: Parameters<typeof tx.execute>[0],
      code: string,
    ) {
      await assert.rejects(
        tx.transaction(async (savepoint) => {
          await savepoint.execute(statement);
        }),
        (error: unknown) => postgresCode(error) === code,
      );
    }
    await rejects(
      sql`UPDATE places SET osm_type='node', point_derivation='osm_node' WHERE id=${hutId}`,
      '23505',
    );
    await rejects(
      sql`UPDATE places SET kinds=ARRAY['pass','pass'] WHERE id=${placeId}`,
      '23514',
    );
    await rejects(
      sql`UPDATE places SET subtypes=ARRAY['alpine_hut'] WHERE id=${placeId}`,
      '23514',
    );
    await rejects(
      sql`UPDATE places SET kinds=ARRAY['settlement'] WHERE id=${placeId}`,
      '23514',
    );
    await rejects(
      sql`UPDATE places SET display_name=' ' WHERE id=${placeId}`,
      '23514',
    );
    await rejects(
      sql`UPDATE places SET tags='{"ele":1234}'::jsonb WHERE id=${placeId}`,
      '23514',
    );
    await rejects(
      sql`UPDATE places SET elevation_m='NaN'::real WHERE id=${placeId}`,
      '23514',
    );
    await rejects(
      sql`UPDATE places SET location='SRID=4326;POINT EMPTY'::geography WHERE id=${placeId}`,
      '23514',
    );
    await rejects(
      sql`UPDATE activity_places SET encounters='[]'::jsonb WHERE place_id=${placeId}`,
      '23514',
    );
    await rejects(
      sql`UPDATE activity_places SET supported_relations=ARRAY['crossed_pass','crossed_pass'] WHERE place_id=${placeId}`,
      '23514',
    );
    await rejects(
      sql`UPDATE activity_places SET parameters_hash='not-a-hash' WHERE place_id=${placeId}`,
      '23514',
    );
    await rejects(sql`DELETE FROM places WHERE id=${placeId}`, '23503');
    await assert.rejects(
      tx.transaction(async (savepoint) => {
        await savepoint.insert(activityPlaces).values(membership);
      }),
      (error: unknown) => postgresCode(error) === '23505',
    );
    await rejects(
      sql`UPDATE activity_places SET activity_id=9223372036854775807 WHERE place_id=${placeId}`,
      '23503',
    );

    // The current catalogue is tiny. Disable sequential scans solely to prove
    // the planner can use our geography and reverse-membership indexes.
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const spatialPlan = await tx.execute(sql`EXPLAIN (FORMAT JSON)
      SELECT id FROM places WHERE ST_DWithin(location,
        ST_SetSRID(ST_MakePoint(${point.longitude},${point.latitude}),4326)::geography,50)`);
    assert.match(JSON.stringify(spatialPlan.rows), /places_location_idx/);
    const reversePlan = await tx.execute(sql`EXPLAIN (FORMAT JSON)
      SELECT activity_id FROM activity_places WHERE place_id=${placeId}`);
    assert.match(
      JSON.stringify(reversePlan.rows),
      /activity_places_place_activity_idx/,
    );

    await tx.delete(users).where(eq(users.id, `places-proof-${placeId}`));
    assert.equal(
      (
        await tx
          .select()
          .from(activityPlaces)
          .where(eq(activityPlaces.placeId, placeId))
      ).length,
      0,
      'account erasure cascades through activities to private place evidence',
    );
    assert.equal(
      (await tx.select().from(places).where(eq(places.id, placeId))).length,
      1,
      'account erasure preserves the independent OSM catalogue',
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  console.log(
    'Place schema proof passed: exact IDs/coordinates/evidence, constraints, indexes and erasure; fixtures rolled back.',
  );
} finally {
  await pool.end();
  for (const socket of proxy.clients) socket.terminate();
  await new Promise<void>((resolve, reject) =>
    proxy.close((error) => (error ? reject(error) : resolve())),
  );
}
