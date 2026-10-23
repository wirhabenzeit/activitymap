import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { z } from 'zod';

import { placeCatalogues, places } from '~/server/db/schema';

import {
  type ValidatedCatalogue,
  canonicalJson,
  catalogueRegionSchema,
  validateCatalogue,
} from './catalogue-artifact';
import { catalogueCoverageContains } from './catalogue-combine';
import {
  comparablePlace,
  fromStored,
  sourceKey,
  toInsert,
} from './catalogue-import';

export type CatalogueRefreshOptions = {
  regionId: string;
  dryRun?: boolean;
  /** Compare-and-set: null means the region has never been published. */
  expectedCurrentSnapshot?: string | null;
  batchSize?: number;
  allowLargeRetirement?: boolean;
  replaceRegion?: { regionId: string; expectedSnapshotId: string };
};

function content(row: Parameters<typeof comparablePlace>[0]) {
  return comparablePlace({ ...row, catalogue_snapshot_id: 'comparison' });
}

/** Publish a complete regional extract, never a partial POI response. All writes,
 * including retirement and the active manifest/coverage, commit together. */
export async function refreshCatalogue(
  client: postgres.Sql,
  input: ValidatedCatalogue,
  options: CatalogueRefreshOptions,
) {
  const catalogue = validateCatalogue(input);
  const regionId = catalogueRegionSchema.parse(options.regionId);
  if (catalogue.manifest.region_id && catalogue.manifest.region_id !== regionId)
    throw new Error('Artifact region does not match the publication target');
  const dryRun = z.boolean().parse(options.dryRun ?? true);
  const batchSize = z
    .number()
    .int()
    .min(1)
    .max(2000)
    .parse(options.batchSize ?? 500);
  if (!dryRun && options.expectedCurrentSnapshot === undefined)
    throw new Error(
      'Publication requires expectedCurrentSnapshot from a dry run',
    );
  const snapshotId = catalogue.manifest.catalogue_snapshot_id;
  const incoming = new Map(catalogue.rows.map((row) => [sourceKey(row), row]));

  return drizzle(client).transaction(async (db) => {
    // Same lock/order as the frozen importer. Ordinary writers are also blocked;
    // readers retain the previous committed catalogue throughout publication.
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('activitymap-place-catalogue-import', 0))`,
    );
    await db.execute(
      sql`LOCK TABLE places, place_catalogues IN SHARE ROW EXCLUSIVE MODE`,
    );
    const [current] = await db
      .select()
      .from(placeCatalogues)
      .where(
        and(
          eq(placeCatalogues.regionId, regionId),
          eq(placeCatalogues.active, true),
        ),
      );
    const currentSnapshot = current?.snapshotId ?? null;
    if (
      options.expectedCurrentSnapshot !== undefined &&
      options.expectedCurrentSnapshot !== currentSnapshot
    )
      throw new Error('Catalogue changed since dry run; review a new dry run');
    let replaced: typeof current | undefined;
    if (options.replaceRegion) {
      const previousRegion = catalogueRegionSchema.parse(
        options.replaceRegion.regionId,
      );
      if (previousRegion === regionId || current)
        throw new Error('Region consolidation requires a new target region');
      [replaced] = await db
        .select()
        .from(placeCatalogues)
        .where(
          and(
            eq(placeCatalogues.regionId, previousRegion),
            eq(placeCatalogues.active, true),
          ),
        );
      if (replaced?.snapshotId !== options.replaceRegion.expectedSnapshotId)
        throw new Error('Replaced region changed since dry run');
      if (
        !catalogue.manifest.components?.some(
          (component) => component.region_id === previousRegion,
        ) ||
        !catalogueCoverageContains(catalogue.coverage, replaced.coverage)
      )
        throw new Error(
          'Combined catalogue must include the replaced region and all its coverage',
        );
      if (
        Date.parse(catalogue.manifest.source.data_as_of) <
        Date.parse(replaced.manifest.source.data_as_of)
      )
        throw new Error(
          'Combined source snapshot is older than the replaced region',
        );
    }
    if (current) {
      const previousTime = Date.parse(current.manifest.source.data_as_of);
      const nextTime = Date.parse(catalogue.manifest.source.data_as_of);
      if (
        nextTime < previousTime ||
        (nextTime === previousTime &&
          current.manifest.source.pbf_sha256 !==
            catalogue.manifest.source.pbf_sha256)
      )
        throw new Error('Refusing an older or conflicting source snapshot');
    }
    const existing = await db.select().from(places);
    const bySource = new Map(
      existing.map((row) => [sourceKey(fromStored(row)), row]),
    );
    const legacy = existing.filter((row) => row.catalogueRegion === null);
    // Adopt the exact old frozen artifact first; never infer region ownership
    // from coordinates or assign unknown rows during a newer refresh.
    if (
      legacy.length &&
      !current &&
      legacy.length === catalogue.rows.length &&
      legacy.every((row) => {
        const next = incoming.get(sourceKey(fromStored(row)));
        return (
          next &&
          row.retiredAt === null &&
          comparablePlace(fromStored(row)) === comparablePlace(next)
        );
      })
    ) {
      // Valid legacy adoption, performed below with the other updates.
    } else if (legacy.length) {
      throw new Error(
        'Unassigned frozen places exist; publish their exact original artifact first',
      );
    }
    for (const row of catalogue.rows) {
      const stored = bySource.get(sourceKey(row));
      if (
        stored?.catalogueRegion &&
        stored.catalogueRegion !== regionId &&
        stored.catalogueRegion !== replaced?.regionId
      )
        throw new Error(
          `Overlapping regions require reconciliation: ${sourceKey(row)}`,
        );
      if (
        stored &&
        (row.osm_version < stored.osmVersion ||
          Date.parse(row.osm_updated_at) < stored.osmUpdatedAt.getTime())
      )
        throw new Error(`Source version regressed: ${sourceKey(row)}`);
    }
    const owned = existing.filter(
      (row) =>
        (row.catalogueRegion === regionId ||
          row.catalogueRegion === replaced?.regionId) &&
        row.retiredAt === null,
    );
    const retired = owned.filter(
      (row) => !incoming.has(sourceKey(fromStored(row))),
    );
    const largeRetirement =
      owned.length > 0 && retired.length / owned.length > 0.2;
    if (!dryRun && largeRetirement && !options.allowLargeRetirement)
      throw new Error(
        'Refresh would retire more than 20% of the region; inspect the extract and explicitly allow large retirement',
      );
    let added = 0,
      updated = 0,
      unchanged = 0,
      reactivated = 0;
    for (const row of catalogue.rows) {
      const stored = bySource.get(sourceKey(row));
      if (!stored) added++;
      else if (stored.retiredAt) reactivated++;
      else if (content(fromStored(stored)) !== content(row)) updated++;
      else unchanged++;
    }
    const [previous] = await db
      .select()
      .from(placeCatalogues)
      .where(eq(placeCatalogues.snapshotId, snapshotId));
    if (
      previous &&
      (previous.regionId !== regionId ||
        canonicalJson(previous.manifest) !==
          canonicalJson(catalogue.manifest) ||
        canonicalJson(previous.coverage) !== canonicalJson(catalogue.coverage))
    )
      throw new Error(
        'Snapshot identity already exists with different artifact contents or region',
      );
    const exact =
      currentSnapshot === snapshotId &&
      added === 0 &&
      updated === 0 &&
      reactivated === 0 &&
      retired.length === 0 &&
      legacy.length === 0;
    const report = {
      status: exact ? 'unchanged' : dryRun ? 'would_publish' : 'published',
      regionId,
      previousSnapshotId: currentSnapshot,
      snapshotId,
      count: catalogue.rows.length,
      added,
      updated,
      unchanged,
      reactivated,
      retired: retired.length,
      adopted: legacy.length,
      ...(replaced
        ? {
            replacedRegion: {
              regionId: replaced.regionId,
              snapshotId: replaced.snapshotId,
            },
          }
        : {}),
      largeRetirement,
      sourceDataAsOf: catalogue.manifest.source.data_as_of,
      coverageChanged: current
        ? current.manifest.coverage.sha256 !==
          catalogue.manifest.coverage.sha256
        : true,
      counts: catalogue.manifest.counts,
      // Bounded examples keep the dry-run report readable even on first import.
      examples: {
        added: catalogue.rows
          .filter((row) => !bySource.has(sourceKey(row)))
          .slice(0, 20)
          .map((row) => ({ source: sourceKey(row), name: row.display_name })),
        updated: catalogue.rows
          .filter((row) => {
            const stored = bySource.get(sourceKey(row));
            return stored && content(fromStored(stored)) !== content(row);
          })
          .slice(0, 20)
          .map((row) => ({ source: sourceKey(row), name: row.display_name })),
        retired: retired.slice(0, 20).map((row) => ({
          source: sourceKey(fromStored(row)),
          name: row.displayName,
        })),
      },
    };
    if (dryRun || exact) return report;
    if (replaced) {
      await db
        .update(places)
        .set({ catalogueRegion: regionId })
        .where(eq(places.catalogueRegion, replaced.regionId));
      await db
        .update(placeCatalogues)
        .set({ active: false })
        .where(eq(placeCatalogues.snapshotId, replaced.snapshotId));
    }

    // Update only catalogue-owned data; activity evidence is left intact and
    // becomes stale through its existing snapshot identity checks.
    for (let offset = 0; offset < catalogue.rows.length; offset += batchSize) {
      await db
        .insert(places)
        .values(
          catalogue.rows.slice(offset, offset + batchSize).map((row) => ({
            ...toInsert(row),
            catalogueRegion: regionId,
            retiredAt: null,
          })),
        )
        .onConflictDoUpdate({
          target: [places.osmType, places.osmId],
          set: {
            kinds: sql`excluded.kinds`,
            subtypes: sql`excluded.subtypes`,
            displayName: sql`excluded.display_name`,
            names: sql`excluded.names`,
            location: sql`excluded.location`,
            elevationM: sql`excluded.elevation_m`,
            tags: sql`excluded.tags`,
            osmVersion: sql`excluded.osm_version`,
            osmUpdatedAt: sql`excluded.osm_updated_at`,
            pointDerivation: sql`excluded.point_derivation`,
            normalizationVersion: sql`excluded.normalization_version`,
            catalogueSnapshotId: sql`excluded.catalogue_snapshot_id`,
            catalogueRegion: regionId,
            retiredAt: null,
            importedAt: sql`now()`,
          },
        });
    }
    for (let offset = 0; offset < retired.length; offset += batchSize)
      await db
        .update(places)
        .set({ retiredAt: new Date() })
        .where(
          inArray(
            places.id,
            retired.slice(offset, offset + batchSize).map((row) => row.id),
          ),
        );
    await db
      .update(placeCatalogues)
      .set({ active: false })
      .where(eq(placeCatalogues.regionId, regionId));
    await db
      .insert(placeCatalogues)
      .values({
        snapshotId,
        regionId,
        active: true,
        manifest: catalogue.manifest,
        coverage: catalogue.coverage,
      })
      .onConflictDoUpdate({
        target: placeCatalogues.snapshotId,
        set: { active: true, publishedAt: new Date() },
      });
    return report;
  });
}
