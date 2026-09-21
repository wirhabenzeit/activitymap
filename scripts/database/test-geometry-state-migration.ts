import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

import {
  loadMigrationDescriptors,
  MIGRATIONS_FOLDER,
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling.ts';
import { runMigrationOperation } from './migrate.ts';

const environment = process.env;
const target = resolveMigrationTarget(environment);

if (
  !target.isLocal ||
  environment.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
) {
  throw new Error(
    'The geometry-state migration fixture may only reset a guarded local *_test database',
  );
}

const client = postgres(target.connectionString, {
  max: 1,
  onnotice: () => undefined,
  prepare: false,
});

async function resetTestDatabase(): Promise<void> {
  await client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await client.unsafe('CREATE SCHEMA public');
}

async function applyMigrationsBeforeGeometryConstraint(): Promise<void> {
  const migrations = loadMigrationDescriptors();
  const constraintIndex = migrations.findIndex(
    (migration) => migration.tag === '0008_enforce-geometry-state',
  );
  assert.equal(constraintIndex, 8);

  for (const migration of migrations.slice(0, constraintIndex)) {
    const migrationSql = readFileSync(
      resolve(MIGRATIONS_FOLDER, `${migration.tag}.sql`),
      'utf8',
    );
    for (const statement of migrationSql.split('--> statement-breakpoint')) {
      if (statement.trim()) await client.unsafe(statement);
    }

    await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await client`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `;
    await client`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${migration.hash}, ${migration.folderMillis})
    `;
  }
}

async function seedLegacyRows(): Promise<void> {
  await client`
    INSERT INTO "user" (id, athlete_id)
    VALUES ('geometry-state-migration-user', 9300001)
  `;
  await client`
    INSERT INTO activities (
      id, public_id, athlete, name, sport_type, start_date,
      start_date_local, timezone, is_complete, geometry_state
    )
    VALUES
      (
        9100001, 9200001, 9300001, 'Legacy detail', 'Run',
        '2026-01-01T08:00:00Z', '2026-01-01T08:00:00Z',
        '(GMT+01:00) Europe/Zurich', true, NULL
      ),
      (
        9100002, 9200002, 9300001, 'Legacy summary', 'Run',
        '2026-01-02T08:00:00Z', '2026-01-02T08:00:00Z',
        '(GMT+01:00) Europe/Zurich', false, NULL
      ),
      (
        9100003, 9200003, 9300001, 'Already classified', 'Run',
        '2026-01-03T08:00:00Z', '2026-01-03T08:00:00Z',
        '(GMT+01:00) Europe/Zurich', true, 'refresh_required'
      )
  `;
}

async function verifyBackfillAndConstraint(): Promise<void> {
  const rows = await client<
    Array<{ geometry_state: string; id: string; is_complete: boolean }>
  >`
    SELECT id::text, is_complete, geometry_state::text
    FROM activities
    ORDER BY id
  `;
  assert.deepEqual([...rows], [
    { geometry_state: 'detailed', id: '9100001', is_complete: true },
    { geometry_state: 'summary', id: '9100002', is_complete: false },
    {
      geometry_state: 'refresh_required',
      id: '9100003',
      is_complete: true,
    },
  ]);

  const columns = await client<Array<{ is_nullable: string }>>`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activities'
      AND column_name = 'geometry_state'
  `;
  assert.equal(columns[0]?.is_nullable, 'NO');
}

async function main(): Promise<void> {
  await verifyConnectedTarget(client, target);
  await resetTestDatabase();
  try {
    await applyMigrationsBeforeGeometryConstraint();
    await seedLegacyRows();
    await runMigrationOperation('apply', environment);
    await verifyBackfillAndConstraint();
    await runMigrationOperation('check', environment);
    console.log('Geometry-state migration fixture passed.');
  } finally {
    await resetTestDatabase();
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Geometry-state migration fixture failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
