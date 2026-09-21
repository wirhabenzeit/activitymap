import assert from 'node:assert/strict';
import postgres from 'postgres';

import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling.ts';
import { runGeometryFreshnessRecovery } from './recover-geometry-freshness.ts';
import { runMigrationOperation } from './migrate.ts';

const SOURCE_DATABASE = 'activitymap_geometry_source_test';
const targetEnvironment = process.env;
const target = resolveMigrationTarget(targetEnvironment);

if (
  !target.isLocal ||
  targetEnvironment.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
) {
  throw new Error(
    'The geometry recovery fixture may only reset guarded local *_test databases',
  );
}

const adminUrl = new URL(target.connectionString);
adminUrl.pathname = '/postgres';
const sourceUrl = new URL(target.connectionString);
sourceUrl.pathname = `/${SOURCE_DATABASE}`;

const sourceEnvironment: NodeJS.ProcessEnv = {
  ...targetEnvironment,
  MIGRATION_DATABASE_URL: sourceUrl.toString(),
  MIGRATION_EXPECTED_DATABASE: SOURCE_DATABASE,
};
const recoveryEnvironment: NodeJS.ProcessEnv = {
  ...targetEnvironment,
  RECOVERY_SOURCE_DATABASE_URL: sourceUrl.toString(),
  RECOVERY_SOURCE_EXPECTED_DATABASE: SOURCE_DATABASE,
  RECOVERY_SOURCE_EXPECTED_HOST: target.hostname,
};

const admin = postgres(adminUrl.toString(), {
  max: 1,
  onnotice: () => undefined,
  prepare: false,
});

async function resetSchemas(client: postgres.Sql): Promise<void> {
  await client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await client.unsafe('CREATE SCHEMA public');
}

async function recreateSourceDatabase(): Promise<void> {
  await admin.unsafe(
    `DROP DATABASE IF EXISTS ${SOURCE_DATABASE} WITH (FORCE)`,
  );
  await admin.unsafe(`CREATE DATABASE ${SOURCE_DATABASE} TEMPLATE template0`);
}

async function seedSource(client: postgres.Sql): Promise<void> {
  await client`
    INSERT INTO "user" (id, athlete_id)
    VALUES ('geometry-recovery-source-user', 9400001)
  `;
  await client`
    INSERT INTO activities (
      id, public_id, athlete, name, sport_type, start_date,
      start_date_local, timezone, map_id, map_summary_polyline,
      map_polyline, geometry_state, is_complete
    )
    VALUES
      (
        9410001, 9420001, 9400001, 'Exact match', 'Run', now(), now(),
        'UTC', 'map-1', 'summary-1', 'detail-1', 'detailed', true
      ),
      (
        9410002, 9420002, 9400001, 'Changed route', 'Run', now(), now(),
        'UTC', 'map-2', 'summary-2', 'detail-2', 'detailed', true
      ),
      (
        9410003, 9420003, 9400001, 'Already recovered', 'Run', now(), now(),
        'UTC', 'map-3', 'summary-3', 'detail-3', 'detailed', true
      ),
      (
        9410004, 9420004, 9400001, 'Deleted activity', 'Run', now(), now(),
        'UTC', 'map-4', 'summary-4', 'detail-4', 'detailed', true
      )
  `;
}

async function seedTarget(client: postgres.Sql): Promise<void> {
  await client`
    INSERT INTO "user" (id, athlete_id)
    VALUES ('geometry-recovery-target-user', 9400001)
  `;
  await client`
    INSERT INTO activities (
      id, public_id, athlete, name, sport_type, start_date,
      start_date_local, timezone, map_id, map_summary_polyline,
      map_polyline, geometry_state, is_complete
    )
    VALUES
      (
        9410001, 9420001, 9400001, 'Exact match', 'Run', now(), now(),
        'UTC', 'map-1', 'summary-1', 'detail-1', 'refresh_required', false
      ),
      (
        9410002, 9420002, 9400001, 'Changed route', 'Run', now(), now(),
        'UTC', 'map-2', 'new-summary-2', 'detail-2', 'refresh_required', false
      ),
      (
        9410003, 9420003, 9400001, 'Already recovered', 'Run', now(), now(),
        'UTC', 'map-3', 'summary-3', 'detail-3', 'detailed', true
      )
  `;
}

async function verifyRecovery(client: postgres.Sql): Promise<void> {
  const activities = await client<
    Array<{ geometry_state: string; id: string; is_complete: boolean }>
  >`
    SELECT id::text, geometry_state::text, is_complete
    FROM activities
    WHERE athlete = 9400001
    ORDER BY id
  `;
  assert.deepEqual([...activities], [
    { geometry_state: 'detailed', id: '9410001', is_complete: true },
    {
      geometry_state: 'refresh_required',
      id: '9410002',
      is_complete: false,
    },
    { geometry_state: 'detailed', id: '9410003', is_complete: true },
  ]);

  const changes = await client<Array<{ entity_id: string }>>`
    SELECT entity_id
    FROM sync_change
    WHERE athlete_id = 9400001
    ORDER BY sequence
  `;
  assert.deepEqual([...changes], [{ entity_id: '9410001' }]);
}

async function main(): Promise<void> {
  await recreateSourceDatabase();
  const targetClient = postgres(target.connectionString, {
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });
  const sourceClient = postgres(sourceUrl.toString(), {
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });

  try {
    await verifyConnectedTarget(targetClient, target);
    await resetSchemas(targetClient);
    await runMigrationOperation('apply', targetEnvironment);
    await runMigrationOperation('apply', sourceEnvironment);
    await seedSource(sourceClient);
    await seedTarget(targetClient);

    await runGeometryFreshnessRecovery({
      ...recoveryEnvironment,
      RECOVERY_MODE: 'audit',
    });
    assert.equal(
      (
        await targetClient<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM sync_change
        `
      )[0]?.count,
      0,
    );

    await assert.rejects(
      runGeometryFreshnessRecovery({
        ...recoveryEnvironment,
        RECOVERY_MODE: 'apply',
      }),
      /RECOVERY_CONFIRM/,
    );

    const applyEnvironment: NodeJS.ProcessEnv = {
      ...recoveryEnvironment,
      RECOVERY_CONFIRM: 'RECOVER_2026_09_20_GEOMETRY',
      RECOVERY_MODE: 'apply',
    };
    await runGeometryFreshnessRecovery(applyEnvironment);
    await verifyRecovery(targetClient);

    await runGeometryFreshnessRecovery(applyEnvironment);
    await verifyRecovery(targetClient);
    await targetClient`
      DELETE FROM "user" WHERE athlete_id = 9400001
    `;
    console.log('Geometry freshness recovery PostgreSQL proof passed.');
  } finally {
    await sourceClient.end({ timeout: 5 });
    await targetClient.end({ timeout: 5 });
    await admin.unsafe(
      `DROP DATABASE IF EXISTS ${SOURCE_DATABASE} WITH (FORCE)`,
    );
    await admin.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Geometry recovery fixture failed: ${message}`);
  process.exitCode = 1;
});
