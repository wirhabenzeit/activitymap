import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import {
  loadMigrationDescriptors,
  MIGRATIONS_FOLDER,
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling';
import { runMigrationOperation } from './migrate';
import { RAW_STREAMS_FIXTURE } from '../../src/server/strava/streams.fixture';

const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
)
  throw new Error(
    'Stream migration fixture may only reset a guarded local *_test database',
  );
const client = postgres(target.connectionString, {
  max: 1,
  prepare: false,
  onnotice: () => undefined,
});
async function reset() {
  await client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await client.unsafe('CREATE SCHEMA public');
}
await verifyConnectedTarget(client, target);
try {
  await reset();
  const history = loadMigrationDescriptors();
  const first = history.findIndex(
    (migration) => migration.tag === '0011_stream-lifecycle-and-budget',
  );
  assert.equal(first, 11);
  for (const migration of history.slice(0, first)) {
    for (const statement of readFileSync(
      resolve(MIGRATIONS_FOLDER, `${migration.tag}.sql`),
      'utf8',
    ).split('--> statement-breakpoint')) {
      if (statement.trim()) await client.unsafe(statement);
    }
    await client.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.unsafe(
      'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
    );
    await client`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
  }
  await client`INSERT INTO "user" (id, athlete_id) VALUES ('stream-upgrade-owner', 9183999)`;
  for (const id of [1, 2, 3]) {
    await client`INSERT INTO activities (id, public_id, athlete, name, sport_type, start_date, start_date_local, timezone, geometry_state) VALUES (${id}, ${id}, 9183999, 'Upgrade fixture', 'Ride', '2026-09-01', '2026-09-01', 'UTC', 'summary')`;
  }
  await client`INSERT INTO activity_streams (activity_id, generation, requested_types, payload, revision, source_version, fetched_at, last_attempt_at, last_attempt_status) VALUES (1, 'old-generation-1', ARRAY['time','distance','latlng','altitude','watts','heartrate'], ${client.json(RAW_STREAMS_FIXTURE)}, 12, 'old-all-column-hash', '2026-09-01', '2026-09-01', 'succeeded')`;
  await client`INSERT INTO activity_streams (activity_id, generation, requested_types, payload, revision, fetched_at, last_attempt_at, last_attempt_status) VALUES (2, 'old-generation-2', ARRAY['time'], '{}'::jsonb, 1, '2026-09-01', '2026-09-01', 'succeeded')`;
  await client`INSERT INTO activity_streams (activity_id, generation, attempt_id, requested_types, revision, last_attempt_at, last_attempt_status) VALUES (3, 'old-generation-3', 'abandoned-attempt', ARRAY['time'], 0, '2026-09-01', 'pending')`;
  await runMigrationOperation('apply', process.env);
  const rows = await client<
    Array<{
      activity_id: string;
      generation: string;
      attempt_id: string | null;
      payload: unknown;
      revision: string;
      available_types: string[];
      invalidated_at: Date | null;
      last_attempt_status: string;
    }>
  >`SELECT activity_id::text, generation, attempt_id, payload, revision::text, available_types, invalidated_at, last_attempt_status FROM activity_streams ORDER BY activity_id`;
  assert.deepEqual(rows[0]?.payload, RAW_STREAMS_FIXTURE);
  assert.equal(rows[0]?.revision, '12');
  assert.deepEqual(rows[0]?.available_types, [
    'time',
    'distance',
    'latlng',
    'altitude',
    'watts',
    'heartrate',
  ]);
  assert.deepEqual(rows[1]?.payload, {});
  assert.deepEqual(rows[1]?.available_types, []);
  assert.equal(rows[2]?.payload, null);
  assert.equal(rows[2]?.revision, '0');
  for (const row of rows) {
    assert.notEqual(row.generation, `old-generation-${row.activity_id}`);
    assert.equal(row.attempt_id, null);
    assert.ok(row.invalidated_at);
    assert.equal(row.last_attempt_status, 'invalidated');
  }
  const events =
    await client`SELECT DISTINCT entity_id FROM sync_change WHERE athlete_id = 9183999`;
  assert.equal(
    events.length,
    3,
    'upgraded metadata is observable by existing clients',
  );
  await runMigrationOperation('check', process.env);
  console.log('Stream lifecycle upgrade from #182 fixtures passed.');
} finally {
  await reset();
  await client.end({ timeout: 5 });
}
