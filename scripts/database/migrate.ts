import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

import {
  fingerprintPublicSchema,
  loadBaselineManifest,
  loadMigrationDescriptors,
  MIGRATION_LOCK_NAME,
  MIGRATIONS_FOLDER,
  readMigrationState,
  resolveMigrationTarget,
  validateBaselineManifest,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling.ts';

config({ path: '.env', override: false, quiet: true });

export type Operation =
  'adopt-baseline' | 'apply' | 'check' | 'fingerprint' | 'status';

function parseOperation(value: string | undefined): Operation {
  if (
    value === 'adopt-baseline' ||
    value === 'apply' ||
    value === 'check' ||
    value === 'fingerprint' ||
    value === 'status'
  ) {
    return value;
  }
  throw new Error(
    'Expected one of: status, check, apply, fingerprint, adopt-baseline',
  );
}

function confirmationArgument(): string | undefined {
  const index = process.argv.indexOf('--confirm');
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function withMigrationLock<T>(
  client: postgres.Sql,
  callback: () => Promise<T>,
): Promise<T> {
  await client`SELECT pg_advisory_lock(hashtextextended(${MIGRATION_LOCK_NAME}, 0))`;
  try {
    return await callback();
  } finally {
    await client`SELECT pg_advisory_unlock(hashtextextended(${MIGRATION_LOCK_NAME}, 0))`;
  }
}

function printState(
  state: Awaited<ReturnType<typeof readMigrationState>>,
): void {
  console.log(`Applied migrations: ${state.applied.length}`);
  console.log(`Pending migrations: ${state.pending.length}`);
  for (const migration of state.pending) console.log(`- ${migration.tag}`);
  if (state.unbaselined) {
    console.log('Baseline adoption required: public schema is not empty.');
  }
}

async function adoptBaseline(
  client: postgres.Sql,
  confirmation: string | undefined,
): Promise<void> {
  const migrations = loadMigrationDescriptors();
  const manifest = loadBaselineManifest();
  const baseline = validateBaselineManifest(migrations, manifest);

  if (confirmation !== baseline.hash) {
    throw new Error(
      'Baseline adoption requires --confirm followed by the complete baseline migration SHA-256',
    );
  }

  await withMigrationLock(client, async () => {
    const state = await readMigrationState(client, migrations);
    if (state.applied.length > 0) {
      throw new Error(
        'Baseline is already recorded; adoption is not applicable',
      );
    }
    if (!state.unbaselined) {
      throw new Error(
        'Baseline adoption is only for an existing non-empty schema; use db:migrate for an empty database',
      );
    }

    const fingerprint = await fingerprintPublicSchema(client);
    console.log(`Live schema fingerprint: ${fingerprint.hash}`);
    if (fingerprint.hash !== manifest.schemaSha256) {
      throw new Error(
        `Live schema does not match the baseline (expected ${manifest.schemaSha256})`,
      );
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
      VALUES (${baseline.hash}, ${baseline.folderMillis})
    `;
    console.log(`Recorded verified baseline ${baseline.tag}.`);
  });
}

export async function runMigrationOperation(
  operation: Operation,
  environment: NodeJS.ProcessEnv = process.env,
  confirmation?: string,
): Promise<void> {
  const target = resolveMigrationTarget(environment);
  const client = postgres(target.connectionString, {
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });

  console.log(`Migration target: ${target.identity}`);
  try {
    await verifyConnectedTarget(client, target);
    const migrations = loadMigrationDescriptors();
    validateBaselineManifest(migrations, loadBaselineManifest());

    if (operation === 'fingerprint') {
      const fingerprint = await fingerprintPublicSchema(client);
      console.log(`Public schema fingerprint: ${fingerprint.hash}`);
      if (process.argv.includes('--json')) {
        console.log(JSON.stringify(fingerprint.snapshot, null, 2));
      }
      return;
    }

    if (operation === 'adopt-baseline') {
      await adoptBaseline(client, confirmation);
      return;
    }

    const initialState = await readMigrationState(client, migrations);
    printState(initialState);

    if (operation === 'status') return;
    if (operation === 'check') {
      if (initialState.unbaselined || initialState.pending.length > 0) {
        throw new Error('Database migration state is not current');
      }
      console.log('Database migration state is current.');
      return;
    }
    if (initialState.unbaselined) {
      throw new Error(
        'Refusing to apply migrations to a non-empty database without verified baseline adoption',
      );
    }

    await withMigrationLock(client, async () => {
      const lockedState = await readMigrationState(client, migrations);
      if (lockedState.unbaselined) {
        throw new Error(
          'Database became unbaselined while waiting for the lock',
        );
      }
      if (lockedState.pending.length === 0) {
        console.log('No migrations to apply.');
        return;
      }

      console.log(`Applying ${lockedState.pending.length} migration(s)...`);
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

      const finalState = await readMigrationState(client, migrations);
      if (finalState.pending.length > 0 || finalState.unbaselined) {
        throw new Error(
          'Migration runner finished without reaching a current state',
        );
      }
      await client`SELECT 1 AS healthy`;
      console.log('Migrations applied; health query succeeded.');
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function runCli(): Promise<void> {
  await runMigrationOperation(
    parseOperation(process.argv[2]),
    process.env,
    confirmationArgument(),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Migration failed: ${message}`);
    process.exitCode = 1;
  });
}
