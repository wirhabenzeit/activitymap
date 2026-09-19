/**
 * Baseline an existing database into Drizzle's migration history.
 *
 * Both of our databases were built with `drizzle-kit push`, which applies a
 * schema diff directly and records nothing. Drizzle's migrator, by contrast,
 * tracks applied migrations in `drizzle.__drizzle_migrations` and decides what
 * to run by comparing each migration's `when` (from `drizzle/meta/_journal.json`)
 * against the newest `created_at` in that table.
 *
 * Pointing `drizzle-kit migrate` at a pushed database with an empty history
 * would therefore try to replay migration 0000 over a schema that already
 * exists. This script instead records the migrations that are *already*
 * reflected in the database, without executing them, so subsequent
 * `pnpm db:migrate` runs pick up only genuinely new work.
 *
 * Usage:
 *   pnpm db:baseline --list                     # report applied vs pending
 *   pnpm db:baseline --through 0001_flippant_talon
 *   pnpm db:baseline --through 0001_flippant_talon --dry-run
 *
 * The write path is idempotent: migrations already recorded are left alone.
 */
import pg from 'pg';

import {
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  readMigrations,
} from '../src/server/db/migration-files';
import {
  pooledConnectionWarning,
  resolveMigrationUrl,
} from '../src/server/db/migration-url';

function parseArgs(argv: string[]) {
  const list = argv.includes('--list');
  const dryRun = argv.includes('--dry-run');
  const throughIndex = argv.indexOf('--through');
  const through = throughIndex === -1 ? undefined : argv[throughIndex + 1];

  if (throughIndex !== -1 && (!through || through.startsWith('--'))) {
    throw new Error(
      '--through requires a migration tag, e.g. --through 0001_flippant_talon',
    );
  }
  if (!list && !through) {
    throw new Error(
      'Nothing to do. Pass --list to report status, or --through <tag> to baseline.',
    );
  }
  return { list, dryRun, through };
}

async function main() {
  const { list, dryRun, through } = parseArgs(process.argv.slice(2));
  const migrations = readMigrations();
  const target = resolveMigrationUrl();
  const warning = pooledConnectionWarning(target);
  if (warning) console.warn(warning);
  const { url, source } = target;

  const client = new pg.Client({
    connectionString: url,
    ...(source === 'local' ? { ssl: false } : {}),
  });
  await client.connect();

  try {
    // Matches the DDL Drizzle's own migrator uses, so running either first is fine.
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )`,
    );

    const { rows: recorded } = await client.query<{
      hash: string;
      created_at: string;
    }>(`SELECT hash, created_at FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`);
    const recordedHashes = new Set(recorded.map((row) => row.hash));
    const newestRecorded = recorded.reduce(
      (max, row) => Math.max(max, Number(row.created_at)),
      -1,
    );

    console.log(`Database: ${source}`);
    console.log(`Recorded migrations: ${recorded.length}\n`);
    for (const migration of migrations) {
      const state = recordedHashes.has(migration.hash) ? 'applied' : 'pending';
      console.log(`  [${state.padEnd(7)}] ${migration.tag}`);
    }

    if (list) return;

    const throughIdx = migrations.findIndex((m) => m.tag === through);
    if (throughIdx === -1) {
      throw new Error(
        `Unknown migration tag "${through}". Known tags: ${migrations
          .map((m) => m.tag)
          .join(', ')}`,
      );
    }

    const toRecord = migrations
      .slice(0, throughIdx + 1)
      .filter((migration) => !recordedHashes.has(migration.hash));

    if (toRecord.length === 0) {
      console.log(
        `\nNothing to baseline: every migration through ${through} is already recorded.`,
      );
      return;
    }

    // Drizzle only ever compares against the newest recorded `created_at`, so
    // recording something older than a migration already present would be
    // silently ineffective. Refuse rather than guess.
    const oldest = Math.min(...toRecord.map((m) => m.folderMillis));
    if (newestRecorded > oldest) {
      throw new Error(
        'Refusing to baseline: the database already records a migration newer than ' +
          `${toRecord[0]!.tag}. Inspect "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" by hand.`,
      );
    }

    console.log(
      `\n${dryRun ? 'Would record' : 'Recording'} ${toRecord.length} migration(s) as already applied:`,
    );
    for (const migration of toRecord) console.log(`  - ${migration.tag}`);

    if (dryRun) {
      console.log('\n--dry-run: no changes written.');
      return;
    }

    await client.query('BEGIN');
    for (const migration of toRecord) {
      await client.query(
        `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES ($1, $2)`,
        [migration.hash, migration.folderMillis],
      );
    }
    await client.query('COMMIT');

    console.log(
      `\nDone. \`pnpm db:migrate\` will now apply only the migrations after ${through}.`,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
