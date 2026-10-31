import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling';
import { combineCatalogues } from '../../src/server/places/catalogue-combine';
import { importCatalogue } from '../../src/server/places/catalogue-import';
import { refreshCatalogue } from '../../src/server/places/catalogue-refresh';
import { createSyntheticCatalogue } from '../../src/server/places/catalogue.fixture';
import {
  loadPublishedCatalogue,
  loadServingCatalogue,
} from '../../src/server/places/published-catalogue';
import type { NormalizedPlace } from '../../src/server/places/types';
import { createPlacesRepository } from '../../src/server/repositories/places';

const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
)
  throw new Error('Refresh proofs require a guarded local *_test database');
const schema = `place_refresh_${randomUUID().replaceAll('-', '')}`;
const app = `refresh-${randomUUID()}`;
const admin = postgres(target.connectionString, {
  max: 3,
  prepare: false,
  onnotice: () => undefined,
});
function scoped(suffix: string) {
  return postgres(target.connectionString, {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
    connection: {
      search_path: `${schema},public`,
      application_name: `${app}-${suffix}`,
      statement_timeout: 15000,
    },
  });
}
const writer = scoped('writer'),
  second = scoped('second'),
  reader = scoped('reader');
const regionId = 'switzerland';
async function state() {
  const rows = await reader<
    {
      id: string;
      osm_type: string;
      osm_id: string;
      display_name: string;
      catalogue_snapshot_id: string;
      catalogue_region: string | null;
      retired_at: string | null;
      imported_at: string;
    }[]
  >`SELECT id, osm_type, osm_id::text, display_name, catalogue_snapshot_id, catalogue_region, retired_at::text, imported_at::text FROM places ORDER BY osm_type, osm_id`;
  const metadata =
    await reader`SELECT snapshot_id, region_id, active, manifest, coverage, published_at::text FROM place_catalogues ORDER BY snapshot_id`;
  return { rows: [...rows], metadata: [...metadata] };
}
async function waiting(suffix: string) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const [row] =
      await admin`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = ${`${app}-${suffix}`} AND wait_event_type = 'Lock' AND wait_event = 'advisory') AS waiting`;
    if (row?.waiting) return;
    await setTimeout(20);
  }
  throw new Error('Expected publication lock wait');
}
let created = false;
try {
  await verifyConnectedTarget(admin, target);
  await admin`CREATE SCHEMA ${admin(schema)}`;
  created = true;
  for (const table of ['places', 'place_catalogues'])
    await admin`CREATE TABLE ${admin(schema)}.${admin(table)} (LIKE public.${admin(table)} INCLUDING ALL)`;
  const a = createSyntheticCatalogue();
  const aId = a.manifest.catalogue_snapshot_id;
  const b = createSyntheticCatalogue({
    sourceSha256: '1'.repeat(64),
    dataAsOf: '2026-10-21T20:23:47Z',
    regionId,
    transformRows: (rows) => [
      {
        ...rows[0]!,
        display_name: 'Updated summit',
        names: { name: 'Updated summit' },
        tags: { name: 'Updated summit', natural: 'peak' },
        osm_version: 2,
        location: { longitude: 8.15, latitude: 46.95 },
      },
      rows[1]!,
      {
        ...rows[2]!,
        osm_type: 'node',
        osm_id: '999',
        point_derivation: 'osm_node',
      },
    ],
  });
  const bId = b.manifest.catalogue_snapshot_id;
  const options = { regionId, dryRun: false, expectedCurrentSnapshot: null };
  // Historical frozen rows can only be adopted by proving the exact original.
  await importCatalogue(writer, a);
  const frozen = await state();
  await assert.rejects(
    refreshCatalogue(writer, b, options),
    /original artifact/,
  );
  assert.deepEqual(await state(), frozen);
  const dry = await refreshCatalogue(writer, a, { regionId });
  assert.equal(dry.adopted, 3);
  assert.equal(dry.previousSnapshotId, null);
  assert.deepEqual(
    await state(),
    frozen,
    'dry run never changes places or metadata',
  );
  await refreshCatalogue(writer, a, options);
  const adopted = await state();
  assert.deepEqual(
    adopted.rows.map((row) => row.id),
    frozen.rows.map((row) => row.id),
  );
  assert.equal(
    (await loadPublishedCatalogue(reader, regionId)).manifest
      .catalogue_snapshot_id,
    aId,
  );
  assert.equal(
    (await loadServingCatalogue(reader)).manifest.catalogue_snapshot_id,
    aId,
    'Swiss-only databases remain readable before consolidation',
  );
  await assert.rejects(
    loadServingCatalogue(reader, undefined, 'unpublished'),
    /No published catalogue/,
    'explicit region selection never falls back',
  );
  assert.equal(
    (
      await refreshCatalogue(writer, a, {
        ...options,
        expectedCurrentSnapshot: aId,
      })
    ).status,
    'unchanged',
  );
  assert.deepEqual(
    await state(),
    adopted,
    'exact repeat preserves IDs and import/publication times',
  );
  await assert.rejects(
    refreshCatalogue(writer, b, { regionId, dryRun: false }),
    /expectedCurrentSnapshot/,
  );
  await assert.rejects(
    refreshCatalogue(writer, b, { ...options, expectedCurrentSnapshot: bId }),
    /changed since dry run/,
  );
  assert.equal(
    (await refreshCatalogue(writer, b, { regionId })).largeRetirement,
    true,
  );
  await assert.rejects(
    refreshCatalogue(writer, b, { ...options, expectedCurrentSnapshot: aId }),
    /20%/,
  );
  const nextOptions = {
    regionId,
    dryRun: false,
    expectedCurrentSnapshot: aId,
    allowLargeRetirement: true,
    batchSize: 1,
  };
  const preview = await refreshCatalogue(writer, b, {
    ...nextOptions,
    dryRun: true,
  });
  assert.deepEqual(
    [preview.added, preview.updated, preview.unchanged, preview.retired],
    [1, 1, 1, 1],
  );
  assert.deepEqual(await state(), adopted);

  // Fail the final insert after preceding updates. A and its coverage survive.
  await writer`CREATE FUNCTION reject_refresh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.osm_id = 999 THEN RAISE EXCEPTION 'injected refresh failure'; END IF; RETURN NEW; END $$`;
  await writer`CREATE TRIGGER reject_refresh BEFORE INSERT ON places FOR EACH ROW EXECUTE FUNCTION reject_refresh()`;
  await assert.rejects(
    refreshCatalogue(writer, b, nextOptions),
    (error: unknown) =>
      error instanceof Error &&
      error.cause instanceof Error &&
      error.cause.message === 'injected refresh failure',
  );
  assert.deepEqual(
    await state(),
    adopted,
    'failed refresh rolls back all earlier batches and metadata',
  );
  await writer`DROP TRIGGER reject_refresh ON places`;
  await writer`DROP FUNCTION reject_refresh()`;

  // Hold the writer after its first update. Ordinary readers still see A;
  // repeatable-read consumers keep A even after B commits. A second publisher
  // that reviewed A must fail once the first publisher commits B.
  const gate = randomInt(1, 2147483647);
  await writer.unsafe(`CREATE FUNCTION pause_refresh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.osm_id = 9007199254740993 THEN PERFORM pg_advisory_xact_lock(${gate}); END IF; RETURN NEW; END $$`);
  await writer`CREATE TRIGGER pause_refresh BEFORE UPDATE ON places FOR EACH ROW EXECUTE FUNCTION pause_refresh()`;
  const hold = await admin.reserve();
  const pending: Promise<unknown>[] = [];
  try {
    await hold`SELECT pg_advisory_lock(${gate})`;
    const first = refreshCatalogue(writer, b, nextOptions);
    pending.push(first);
    void first.catch(() => undefined);
    await waiting('writer');
    assert.deepEqual(await state(), adopted);
    const concurrent = refreshCatalogue(second, b, nextOptions);
    pending.push(concurrent);
    void concurrent.catch(() => undefined);
    await waiting('second');
    await drizzle(reader).transaction(
      async (transaction) => {
        assert.equal(
          (await loadPublishedCatalogue(reader, regionId, transaction)).manifest
            .catalogue_snapshot_id,
          aId,
        );
        await hold`SELECT pg_advisory_unlock(${gate})`;
        await first;
        await assert.rejects(concurrent, /changed since dry run/);
        await createPlacesRepository(reader, transaction).assertCatalogue(
          aId,
          3,
        );
        assert.equal(
          (await loadPublishedCatalogue(reader, regionId, transaction)).manifest
            .catalogue_snapshot_id,
          aId,
        );
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  } finally {
    await hold`SELECT pg_advisory_unlock(${gate})`;
    hold.release();
    await Promise.allSettled(pending);
  }
  await writer`DROP TRIGGER pause_refresh ON places`;
  await writer`DROP FUNCTION pause_refresh()`;
  const afterB = await state();
  assert.equal(afterB.rows.length, 4);
  assert.equal(afterB.rows.filter((row) => row.retired_at).length, 1);
  assert.equal(afterB.metadata.length, 2);
  assert.equal(
    (await loadPublishedCatalogue(reader, regionId)).manifest
      .catalogue_snapshot_id,
    bId,
  );
  await createPlacesRepository(reader).assertCatalogue(bId, 3);
  const discovery = await createPlacesRepository(reader).discover({
    catalogueSnapshotId: bId,
    coverage: b.coverage,
    geometry: {
      type: 'GeometryCollection',
      geometries: [{ type: 'Point', coordinates: [8.3, 46.8] }],
    },
    radiusM: 300,
    limit: 10,
  });
  assert.equal(
    discovery.candidates.length,
    1,
    'retired hut excluded despite sharing the new hut coordinates',
  );
  assert.equal(
    discovery.candidates[0]?.id,
    afterB.rows.find((row) => row.osm_id === '999')?.id,
  );
  await assert.rejects(
    refreshCatalogue(writer, a, {
      ...nextOptions,
      expectedCurrentSnapshot: bId,
    }),
    /older/,
  );
  const wrongRegion = createSyntheticCatalogue({ regionId: 'other' });
  await assert.rejects(
    refreshCatalogue(writer, wrongRegion, { ...options, regionId: 'other' }),
    /Overlapping regions/,
  );
  await assert.rejects(
    refreshCatalogue(writer, b, { ...options, regionId: 'wrong' }),
    /region/,
  );
  assert.deepEqual(await state(), afterB);
  // The pass becomes a lowland crossing that the catalogue filter hides.
  const versionThree = (rows: NormalizedPlace[]) =>
    rows.map((row, index) => ({
      ...row,
      osm_version: 3,
      ...(index === 1
        ? { elevation_m: 680, dem_elevation_m: 681.3, pass_amp_m: 20.7 }
        : {}),
    }));
  const c = createSyntheticCatalogue({
    sourceSha256: '2'.repeat(64),
    dataAsOf: '2026-10-22T20:23:47Z',
    regionId,
    transformRows: versionThree,
  });
  const restored = await refreshCatalogue(writer, c, {
    ...nextOptions,
    expectedCurrentSnapshot: bId,
  });
  assert.equal(restored.reactivated, 1);
  const afterC = await state();
  const originalHut = frozen.rows.find((row) => row.osm_type === 'way')!;
  const returnedHut = afterC.rows.find((row) => row.osm_type === 'way')!;
  assert.equal(returnedHut.id, originalHut.id);
  assert.equal(returnedHut.retired_at, null);
  // Hidden places stay stored and counted but are never candidates.
  const [hiddenPass] = await reader<
    { hidden_reason: string | null; pass_amp_m: number | null }[]
  >`SELECT hidden_reason, pass_amp_m FROM places WHERE osm_id = 9007199254740994`;
  assert.deepEqual(
    { ...hiddenPass },
    { hidden_reason: 'low_relief_pass', pass_amp_m: 20.7 },
  );
  assert.equal(c.manifest.counts.filter?.hidden, 1);
  await createPlacesRepository(reader).assertCatalogue(
    c.manifest.catalogue_snapshot_id,
    3,
  );
  const hiddenDiscovery = await createPlacesRepository(reader).discover({
    catalogueSnapshotId: c.manifest.catalogue_snapshot_id,
    coverage: c.coverage,
    geometry: {
      type: 'GeometryCollection',
      geometries: [{ type: 'Point', coordinates: [8.2, 46.9] }],
    },
    radiusM: 300,
    limit: 10,
  });
  assert.equal(hiddenDiscovery.candidates.length, 0, 'hidden pass excluded');
  assert.equal(
    (
      await refreshCatalogue(writer, c, {
        ...nextOptions,
        expectedCurrentSnapshot: c.manifest.catalogue_snapshot_id,
      })
    ).status,
    'unchanged',
    'terrain metrics round-trip through PostgreSQL real',
  );
  // Fresh region publication and independent retirement scope.
  const other = createSyntheticCatalogue({
    sourceSha256: '3'.repeat(64),
    regionId: 'other',
    transformRows: (rows) =>
      rows.map((row) => ({
        ...row,
        osm_id: (BigInt(row.osm_id) + 1000n).toString(),
      })),
  });
  await refreshCatalogue(writer, other, { ...options, regionId: 'other' });
  assert.equal(
    (await loadPublishedCatalogue(reader, regionId)).manifest
      .catalogue_snapshot_id,
    c.manifest.catalogue_snapshot_id,
  );
  await createPlacesRepository(reader).assertCatalogue(
    c.manifest.catalogue_snapshot_id,
    3,
  );
  const beforeOtherRefresh = (await state()).rows.filter(
    (row) => row.catalogue_region === regionId,
  );
  const otherB = createSyntheticCatalogue({
    sourceSha256: '4'.repeat(64),
    regionId: 'other',
    dataAsOf: '2026-10-23T00:00:00Z',
    transformRows: (rows) =>
      rows.slice(0, 1).map((row) => ({
        ...row,
        osm_id: (BigInt(row.osm_id) + 1000n).toString(),
      })),
  });
  await refreshCatalogue(writer, otherB, {
    ...options,
    regionId: 'other',
    expectedCurrentSnapshot: other.manifest.catalogue_snapshot_id,
    allowLargeRetirement: true,
  });
  assert.deepEqual(
    (await state()).rows.filter((row) => row.catalogue_region === regionId),
    beforeOtherRefresh,
  );

  const neighbor = createSyntheticCatalogue({
    regionId: 'neighbor',
    dataAsOf: c.manifest.source.data_as_of,
    transformRows: versionThree,
  });
  const combined = combineCatalogues('ch-at-it', [c, neighbor]);
  const consolidatedOptions = {
    regionId: 'ch-at-it',
    dryRun: false,
    expectedCurrentSnapshot: null,
    replaceRegion: {
      regionId,
      expectedSnapshotId: c.manifest.catalogue_snapshot_id,
    },
  };
  const beforeConsolidation = await state();
  await assert.rejects(
    refreshCatalogue(writer, combined, {
      ...consolidatedOptions,
      replaceRegion: undefined,
    }),
    /Overlapping regions/,
  );
  await assert.rejects(
    refreshCatalogue(writer, combined, {
      ...consolidatedOptions,
      replaceRegion: { regionId, expectedSnapshotId: aId },
    }),
    /changed since dry run/,
  );
  const consolidationPreview = await refreshCatalogue(writer, combined, {
    ...consolidatedOptions,
    dryRun: true,
  });
  assert.equal(consolidationPreview.replacedRegion?.regionId, regionId);
  assert.deepEqual(await state(), beforeConsolidation);
  await writer`CREATE FUNCTION reject_consolidation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.catalogue_region = 'ch-at-it' THEN RAISE EXCEPTION 'injected consolidation failure'; END IF; RETURN NEW; END $$`;
  await writer`CREATE TRIGGER reject_consolidation BEFORE UPDATE ON places FOR EACH ROW EXECUTE FUNCTION reject_consolidation()`;
  await assert.rejects(refreshCatalogue(writer, combined, consolidatedOptions));
  assert.deepEqual(await state(), beforeConsolidation);
  await writer`DROP TRIGGER reject_consolidation ON places`;
  await writer`DROP FUNCTION reject_consolidation()`;
  await refreshCatalogue(writer, combined, consolidatedOptions);
  const consolidated = await state();
  assert.deepEqual(
    consolidated.rows
      .filter((row) => row.catalogue_region === 'ch-at-it')
      .map((row) => row.id),
    beforeConsolidation.rows
      .filter((row) => row.catalogue_region === regionId)
      .map((row) => row.id),
  );
  assert.equal(
    (await loadPublishedCatalogue(reader, 'ch-at-it')).manifest
      .catalogue_snapshot_id,
    combined.manifest.catalogue_snapshot_id,
  );
  assert.equal(
    (await loadServingCatalogue(reader)).manifest.catalogue_snapshot_id,
    combined.manifest.catalogue_snapshot_id,
    'the combined catalogue is automatically preferred after publication',
  );
  await assert.rejects(
    loadServingCatalogue(reader, undefined, regionId),
    /No published catalogue/,
    'an explicitly selected inactive region never silently switches',
  );
  await assert.rejects(
    loadPublishedCatalogue(reader, regionId),
    /No published/,
  );
  assert.deepEqual(
    consolidated.rows.filter((row) => row.catalogue_region === 'other'),
    beforeConsolidation.rows.filter((row) => row.catalogue_region === 'other'),
  );
  console.log(
    'Refresh proof passed: frozen adoption, dry run, A→A, A→B, stable IDs, retirement/reactivation, hidden places, rollback, concurrent publishers, consistent readers, coverage/discovery, source ordering, region isolation and atomic region consolidation.',
  );
} finally {
  await Promise.all([writer.end(), second.end(), reader.end()]);
  if (created) await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
  await admin.end();
}
