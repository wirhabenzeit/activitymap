import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '~/server/db';
import { listedPlaceCount } from '~/server/places/catalogue-artifact';
import {
  isServingRegion,
  servingRegionRank,
} from '~/server/places/catalogue-regions';
import type { PlaceRow } from '~/server/places/catalogue-rows';
import { validatePublishedCatalogue } from '~/server/places/published-catalogue';

import type { CatalogueSource } from './convex-catalogue';

type PlaceRecord = {
  id: string;
  display_name: string;
  kinds: string[];
  subtypes: string[];
  elevation_m: number | null;
  longitude: number;
  latitude: number;
};

/**
 * The catalogue the batch matcher reads (`loadBatchPlaceCatalogue`): the
 * active serving snapshot, its revision, and its rows that are neither
 * retired nor hidden. Never reads OSM tags or anything about an account.
 */
export function postgresCatalogueSource(
  database: Pick<typeof db, 'transaction' | 'execute'> = db,
): CatalogueSource {
  return {
    current: () =>
      database.transaction(
        async (tx) => {
          const row = (
            await tx.execute<{
              snapshot_id: string;
              manifest: unknown;
              coverage: unknown;
            }>(sql`
              SELECT snapshot_id, manifest, coverage FROM place_catalogues
              WHERE active AND ${isServingRegion(sql`region_id`)}
              ORDER BY ${servingRegionRank(sql`region_id`)} LIMIT 1
            `)
          ).rows[0];
          if (!row) throw new Error('No published place catalogue');
          const catalogue = validatePublishedCatalogue(
            row as Parameters<typeof validatePublishedCatalogue>[0],
          );
          if (catalogue.manifest.catalogue_snapshot_id !== row.snapshot_id)
            throw new Error('Catalogue identity mismatch');
          const revision = (
            await tx.execute<{ revision: string }>(
              sql`SELECT revision::text FROM place_catalogue_revision WHERE singleton`,
            )
          ).rows[0]?.revision;
          if (revision === undefined)
            throw new Error('Missing place catalogue revision');
          return {
            snapshotId: row.snapshot_id,
            revision,
            count: listedPlaceCount(catalogue.manifest),
            metadata: {
              manifest: catalogue.manifest,
              coverage: catalogue.coverage,
            },
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),

    async places(snapshotId, after, limit) {
      // Place IDs are UUIDs: Postgres orders them as their lowercase text.
      const { rows } = await database.execute<PlaceRecord>(sql`
        SELECT id, display_name, kinds, subtypes, elevation_m,
          ST_X(location::geometry) AS longitude,
          ST_Y(location::geometry) AS latitude
        FROM places
        WHERE retired_at IS NULL AND hidden_reason IS NULL
          AND catalogue_snapshot_id = ${snapshotId}
          ${after ? sql`AND id > ${after}::uuid` : sql``}
        ORDER BY id LIMIT ${limit}
      `);
      return rows.map((row): PlaceRow => ({
        id: row.id,
        displayName: row.display_name,
        kinds: [...row.kinds],
        subtypes: [...row.subtypes],
        location: { longitude: row.longitude, latitude: row.latitude },
        ...(row.elevation_m === null ? {} : { elevationM: row.elevation_m }),
      }));
    },
  };
}
