import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { resolveMigrationTarget } from '../../src/server/db/migration-tooling';
import { places } from '../../src/server/db/schema';
import { importCatalogue } from '../../src/server/places/catalogue-import';
import { createSyntheticCatalogue } from '../../src/server/places/catalogue.fixture';

const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
) {
  throw new Error('Catalogue proofs require a guarded local *_test database');
}

// Only a uniquely named scratch schema is changed. In particular, this proof
// never clears or replaces an already loaded public.places catalogue.
const schema = `place_catalogue_proof_${randomUUID().replaceAll('-', '')}`;
const application = `catalogue-proof-${randomUUID()}`;
const administrator = postgres(target.connectionString, {
  max: 3,
  prepare: false,
  onnotice: () => undefined,
  connection: {
    search_path: 'public',
    application_name: `${application}-admin`,
    statement_timeout: 15_000,
  },
});
function scopedClient(suffix: string) {
  return postgres(target.connectionString, {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
    connection: {
      search_path: `${schema},public`,
      application_name: `${application}-${suffix}`,
      statement_timeout: 15_000,
    },
  });
}
const firstClient = scopedClient('first');
const secondClient = scopedClient('second');
const reader = scopedClient('reader');
let created = false;

function postgresCode(error: unknown): unknown {
  if (!(error instanceof Error)) return undefined;
  if ('code' in error) return error.code;
  return postgresCode(error.cause);
}

async function rowCount() {
  const result = await reader<{ count: number }[]>`
    SELECT count(*)::integer AS count FROM places
  `;
  return result[0]?.count;
}

async function waitForAdvisoryLock(suffix: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await administrator<{ waiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = ${`${application}-${suffix}`}
          AND wait_event_type = 'Lock' AND wait_event = 'advisory'
      ) AS waiting
    `;
    if (result[0]?.waiting) return;
    await setTimeout(25);
  }
  throw new Error(
    `Importer ${suffix} did not reach its expected advisory lock`,
  );
}

try {
  const identity = await administrator<{ database: string }[]>`
    SELECT current_database() AS database
  `;
  assert.equal(identity[0]?.database, target.database);
  await administrator`CREATE SCHEMA ${administrator(schema)}`;
  created = true;
  await administrator`
    CREATE TABLE ${administrator(schema)}.${administrator('places')}
    (LIKE public.places INCLUDING ALL)
  `;
  const current = await firstClient<{ schema: string }[]>`
    SELECT current_schema() AS schema
  `;
  assert.equal(current[0]?.schema, schema);

  const catalogue = createSyntheticCatalogue();
  assert.deepEqual(
    await importCatalogue(firstClient, catalogue, { dryRun: true }),
    {
      status: 'would_import',
      count: 3,
    },
  );
  assert.equal(await rowCount(), 0);

  const invalid = structuredClone(catalogue);
  invalid.rows[0]!.location.latitude = 91;
  await assert.rejects(importCatalogue(firstClient, invalid));
  const changedWithoutHash = structuredClone(catalogue);
  changedWithoutHash.rows[0]!.tags.unverified = 'changed';
  await assert.rejects(
    importCatalogue(firstClient, changedWithoutHash),
    /artifact hash/,
  );
  await assert.rejects(
    importCatalogue(firstClient, catalogue, { batchSize: 0 }),
    /batch size/,
  );
  assert.equal(await rowCount(), 0);

  // A real trigger fails the final row after earlier INSERT batches completed.
  // This exercises PostgreSQL rollback without a production fault-injection API.
  await firstClient`
    CREATE FUNCTION reject_catalogue_proof_row() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.osm_type = 'way' THEN
        RAISE EXCEPTION 'injected catalogue proof failure';
      END IF;
      RETURN NEW;
    END $$
  `;
  await firstClient`
    CREATE TRIGGER reject_catalogue_proof_row BEFORE INSERT ON places
    FOR EACH ROW EXECUTE FUNCTION reject_catalogue_proof_row()
  `;
  await assert.rejects(
    importCatalogue(firstClient, catalogue, { batchSize: 1 }),
    (error: unknown) => postgresCode(error) === 'P0001',
  );
  assert.equal(await rowCount(), 0, 'all earlier batches roll back');
  await firstClient`DROP TRIGGER reject_catalogue_proof_row ON places`;
  await firstClient`DROP FUNCTION reject_catalogue_proof_row()`;

  assert.deepEqual(
    await importCatalogue(firstClient, catalogue, { batchSize: 1 }),
    {
      status: 'imported',
      count: 3,
    },
  );
  const database = drizzle(firstClient);
  const stored = await database
    .select()
    .from(places)
    .orderBy(places.osmType, places.osmId);
  assert.equal(stored.length, 3);
  assert.equal(stored[0]?.osmId, 9007199254740993n);
  assert(stored[0] && typeof stored[0].elevationM === 'number');
  // The text protocol uses a shortest round-trip decimal for float4.
  assert.equal(Math.fround(stored[0].elevationM), Math.fround(1234.56789));
  assert.deepEqual(stored[0]?.location, catalogue.rows[0]?.location);

  assert.deepEqual(await importCatalogue(firstClient, catalogue), {
    status: 'unchanged',
    count: 3,
  });
  assert.deepEqual(
    await importCatalogue(firstClient, catalogue, { dryRun: true }),
    {
      status: 'unchanged',
      count: 3,
    },
  );
  const equivalent = createSyntheticCatalogue({
    transformRows: (rows) =>
      rows.reverse().map((row) => ({
        ...row,
        kinds: [...row.kinds].reverse(),
        subtypes: [...row.subtypes].reverse(),
        names: Object.fromEntries(Object.entries(row.names).reverse()),
        tags: Object.fromEntries(Object.entries(row.tags).reverse()),
        osm_updated_at: '2026-10-20T22:23:47+02:00',
        ...(row.elevation_m === undefined
          ? {}
          : { elevation_m: Math.fround(row.elevation_m) }),
      })),
  });
  assert.deepEqual(await importCatalogue(firstClient, equivalent), {
    status: 'unchanged',
    count: 3,
  });

  for (const conflict of [
    createSyntheticCatalogue({ sourceSha256: '0'.repeat(64) }),
    createSyntheticCatalogue({ transformRows: (rows) => rows.slice(0, 2) }),
    createSyntheticCatalogue({
      transformRows: (rows) => [
        ...rows,
        { ...rows[0]!, osm_id: '9007199254740999' },
      ],
    }),
    createSyntheticCatalogue({
      transformRows: (rows) =>
        rows.map((row, index) =>
          index === 0
            ? { ...row, tags: { ...row.tags, test: 'different' } }
            : row,
        ),
    }),
  ]) {
    await assert.rejects(
      importCatalogue(firstClient, conflict),
      /Frozen catalogue conflict/,
    );
    await assert.rejects(
      importCatalogue(firstClient, conflict, { dryRun: true }),
      /Frozen catalogue conflict/,
    );
  }
  assert.deepEqual(
    await database.select().from(places).orderBy(places.osmType, places.osmId),
    stored,
    'repeat imports and refusals preserve every value, internal ID and import timestamp',
  );

  // Recreate only the scratch table for a concurrent first publication.
  await administrator`DROP TABLE ${administrator(schema)}.${administrator('places')}`;
  await administrator`
    CREATE TABLE ${administrator(schema)}.${administrator('places')}
    (LIKE public.places INCLUDING ALL)
  `;
  const gate = randomInt(1, 2_147_483_647);
  await firstClient.unsafe(`
    CREATE FUNCTION wait_catalogue_proof_row() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.osm_type = 'way' THEN
        PERFORM pg_advisory_xact_lock(${gate});
      END IF;
      RETURN NEW;
    END $$
  `);
  await firstClient`
    CREATE TRIGGER wait_catalogue_proof_row BEFORE INSERT ON places
    FOR EACH ROW EXECUTE FUNCTION wait_catalogue_proof_row()
  `;
  const gateClient = await administrator.reserve();
  const pending: Promise<unknown>[] = [];
  try {
    await gateClient`SELECT pg_advisory_lock(${gate})`;
    const first = importCatalogue(firstClient, catalogue, { batchSize: 1 });
    pending.push(first);
    void first.catch(() => undefined);
    await waitForAdvisoryLock('first');
    assert.equal(
      await rowCount(),
      0,
      'readers cannot see the preceding uncommitted batches',
    );
    const second = importCatalogue(secondClient, catalogue, { batchSize: 1 });
    pending.push(second);
    void second.catch(() => undefined);
    await waitForAdvisoryLock('second');
    assert.equal(await rowCount(), 0);
    await gateClient`SELECT pg_advisory_unlock(${gate})`;
    assert.deepEqual(await first, { status: 'imported', count: 3 });
    assert.deepEqual(await second, { status: 'unchanged', count: 3 });
    assert.equal(await rowCount(), 3);
  } finally {
    await gateClient`SELECT pg_advisory_unlock(${gate})`;
    gateClient.release();
    await Promise.allSettled(pending);
  }
  console.log(
    'Catalogue import proof passed: validation, dry-run, exact repeats, conflict refusal, atomic rollback, concurrent publication and reader visibility.',
  );
} finally {
  await Promise.all([firstClient.end(), secondClient.end(), reader.end()]);
  if (created)
    await administrator`DROP SCHEMA ${administrator(schema)} CASCADE`;
  await administrator.end();
}
