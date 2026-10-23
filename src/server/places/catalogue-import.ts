import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';

import { places } from '~/server/db/schema';
import {
  type ValidatedCatalogue,
  validateCatalogue,
} from '~/server/places/catalogue-artifact';
import type { NormalizedPlace } from '~/server/places/types';

export type CatalogueImportOptions = {
  dryRun?: boolean;
  batchSize?: number;
};

export type CatalogueImportResult = {
  status: 'imported' | 'unchanged' | 'would_import';
  count: number;
};

function orderedRecord(record: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

export function sourceKey(row: Pick<NormalizedPlace, 'osm_type' | 'osm_id'>) {
  return `${row.osm_type}/${row.osm_id}`;
}

export function comparablePlace(row: NormalizedPlace): string {
  return JSON.stringify({
    osm_type: row.osm_type,
    osm_id: row.osm_id,
    kinds: [...row.kinds].sort(),
    subtypes: [...row.subtypes].sort(),
    display_name: row.display_name,
    names: orderedRecord(row.names),
    location: {
      longitude: row.location.longitude,
      latitude: row.location.latitude,
    },
    // PostgreSQL REAL is float4. Compare its actual representation, including
    // decimal inputs that are not exactly representable as a 32-bit float.
    elevation_m:
      row.elevation_m === undefined ? null : Math.fround(row.elevation_m),
    tags: orderedRecord(row.tags),
    osm_version: row.osm_version,
    osm_updated_at: new Date(row.osm_updated_at).toISOString(),
    point_derivation: row.point_derivation,
    normalization_version: row.normalization_version,
    catalogue_snapshot_id: row.catalogue_snapshot_id,
  });
}

export function fromStored(row: typeof places.$inferSelect): NormalizedPlace {
  return {
    osm_type: row.osmType,
    osm_id: row.osmId.toString(),
    kinds: row.kinds,
    subtypes: row.subtypes,
    display_name: row.displayName,
    names: row.names,
    location: row.location,
    ...(row.elevationM === null ? {} : { elevation_m: row.elevationM }),
    tags: row.tags,
    osm_version: row.osmVersion,
    osm_updated_at: row.osmUpdatedAt.toISOString(),
    point_derivation: row.pointDerivation,
    normalization_version: row.normalizationVersion,
    catalogue_snapshot_id: row.catalogueSnapshotId,
  };
}

export function toInsert(row: NormalizedPlace): typeof places.$inferInsert {
  return {
    osmType: row.osm_type,
    osmId: BigInt(row.osm_id),
    kinds: row.kinds,
    subtypes: row.subtypes,
    displayName: row.display_name,
    names: row.names,
    location: row.location,
    elevationM:
      row.elevation_m === undefined ? null : Math.fround(row.elevation_m),
    tags: row.tags,
    osmVersion: row.osm_version,
    osmUpdatedAt: new Date(row.osm_updated_at),
    pointDerivation: row.point_derivation,
    normalizationVersion: row.normalization_version,
    catalogueSnapshotId: row.catalogue_snapshot_id,
  };
}

/**
 * Publish one immutable catalogue, or prove an exact repeat without touching its
 * IDs/import times. The caller supplies an explicitly guarded database client;
 * no environment/default connection, source download, or reconciliation occurs.
 */
export async function importCatalogue(
  client: postgres.Sql,
  input: ValidatedCatalogue,
  options: CatalogueImportOptions = {},
): Promise<CatalogueImportResult> {
  const batchSize = options.batchSize ?? 500;
  const dryRun = options.dryRun ?? false;
  if (typeof dryRun !== 'boolean') {
    throw new Error('Catalogue dry-run option must be a boolean');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 2_000) {
    throw new Error('Catalogue batch size must be an integer from 1 to 2000');
  }

  // Structural TypeScript types are not a trust boundary. Revalidate and clone
  // before opening a transaction so caller mutation cannot change an import
  // while it waits for the publication lock.
  const catalogue = validateCatalogue(input);
  const expected = new Map(
    catalogue.rows.map((row) => [sourceKey(row), comparablePlace(row)]),
  );

  return drizzle(client).transaction(
    async (database): Promise<CatalogueImportResult> => {
      await database.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended('activitymap-place-catalogue-import', 0))
    `);
      // Block every ordinary table writer, including one that ignores the advisory
      // convention. AccessShare readers continue seeing the previous committed
      // catalogue until this complete transaction publishes all batches at once.
      await database.execute(
        sql`LOCK TABLE places IN SHARE ROW EXCLUSIVE MODE`,
      );
      const existing = await database.select().from(places);
      if (existing.length > 0) {
        if (existing.length !== catalogue.rows.length) {
          throw new Error(
            'Frozen catalogue conflict: existing source rowset differs',
          );
        }
        for (const stored of existing) {
          const row = fromStored(stored);
          if (expected.get(sourceKey(row)) !== comparablePlace(row)) {
            throw new Error(`Frozen catalogue conflict at ${sourceKey(row)}`);
          }
        }
        return { status: 'unchanged', count: existing.length };
      }

      if (dryRun) {
        return { status: 'would_import', count: catalogue.rows.length };
      }
      const rows = [...catalogue.rows].sort((left, right) => {
        const a = sourceKey(left);
        const b = sourceKey(right);
        return a < b ? -1 : a > b ? 1 : 0;
      });
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        await database
          .insert(places)
          .values(rows.slice(offset, offset + batchSize).map(toInsert));
      }
      return { status: 'imported', count: rows.length };
    },
  );
}
