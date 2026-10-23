import { and, eq, inArray, sql } from 'drizzle-orm';
import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';

import { placeCatalogues } from '~/server/db/schema';

import {
  type ValidatedCatalogue,
  canonicalJson,
  catalogueManifestSchema,
  catalogueRegionSchema,
  catalogueSnapshotId,
  sha256,
} from './catalogue-artifact';
import { V1_PLACE_REGION } from './catalogue-regions';
import { parseCoverageGeometry } from './coverage';

export type PublishedCatalogue = Pick<
  ValidatedCatalogue,
  'manifest' | 'coverage'
>;

export function validatePublishedCatalogue(
  input: PublishedCatalogue,
): PublishedCatalogue {
  const manifest = catalogueManifestSchema.parse(input.manifest);
  const coverage = parseCoverageGeometry(input.coverage);
  if (
    manifest.catalogue_snapshot_id !== catalogueSnapshotId(manifest) ||
    manifest.coverage.sha256 !== sha256(`${canonicalJson(coverage)}\n`)
  )
    throw new Error('Published catalogue metadata failed integrity validation');
  return { manifest, coverage };
}

/** Call within a repeatable-read transaction when using the result to match
 * tracks, so a concurrent refresh cannot mix coverage with another rowset. */
export async function loadPublishedCatalogue(
  client: postgres.Sql,
  regionId: string,
  database: PostgresJsDatabase = drizzle(client),
): Promise<PublishedCatalogue> {
  catalogueRegionSchema.parse(regionId);
  const [row] = await database
    .select()
    .from(placeCatalogues)
    .where(
      and(
        eq(placeCatalogues.regionId, regionId),
        eq(placeCatalogues.active, true),
      ),
    );
  if (!row) throw new Error(`No published catalogue for region ${regionId}`);
  const catalogue = validatePublishedCatalogue(row);
  if (
    catalogue.manifest.catalogue_snapshot_id !== row.snapshotId ||
    (catalogue.manifest.region_id && catalogue.manifest.region_id !== regionId)
  )
    throw new Error('Published catalogue region/snapshot identity disagrees');
  return catalogue;
}

/** Prefer the combined v1 catalogue after publication, while existing Swiss-only
 * development databases remain usable. Explicit configuration never falls back. */
export async function loadServingCatalogue(
  client: postgres.Sql,
  database: PostgresJsDatabase = drizzle(client),
  configuredRegion?: string,
): Promise<PublishedCatalogue> {
  if (configuredRegion)
    return loadPublishedCatalogue(client, configuredRegion, database);
  const [preferred] = await database
    .select({ regionId: placeCatalogues.regionId })
    .from(placeCatalogues)
    .where(
      and(
        eq(placeCatalogues.active, true),
        inArray(placeCatalogues.regionId, [V1_PLACE_REGION, 'switzerland']),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${placeCatalogues.regionId} = ${V1_PLACE_REGION} THEN 0 ELSE 1 END`,
    )
    .limit(1);
  if (!preferred) throw new Error('No published v1 place catalogue');
  return loadPublishedCatalogue(client, preferred.regionId, database);
}
