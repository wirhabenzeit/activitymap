import 'server-only';

import { sql } from 'drizzle-orm';

import type { PlaceMatchingSnapshot } from '~/server/application/batch-activity-places';
import { db } from '~/server/db';
import { V1_PLACE_REGION } from '~/server/places/catalogue-regions';
import { validatePublishedCatalogue } from '~/server/places/published-catalogue';
import {
  type PlaceQueryWindow,
  uniqueQueryWindows,
} from '~/server/places/query-windows';

import type { CandidatePlace } from './places';

type CatalogueRow = {
  snapshot_id: string;
  manifest: unknown;
  coverage: unknown;
};
type PlaceRow = {
  id: string;
  display_name: string;
  kinds: CandidatePlace['kinds'];
  subtypes: CandidatePlace['subtypes'];
  elevation_m: number | null;
  longitude: number;
  latitude: number;
};

/** Metadata, revision and minimal rows in one snapshot. Never loads OSM tags,
 * activity streams or account data. Each invocation gets its own pinned copy. */
export async function loadBatchPlaceCatalogue(
  database: Pick<typeof db, 'transaction'> = db,
  selection: { windows: readonly PlaceQueryWindow[] } | undefined = undefined,
): Promise<PlaceMatchingSnapshot> {
  const windows = selection && uniqueQueryWindows(selection.windows);
  return database.transaction(
    async (tx) => {
      const row = (
        await tx.execute<CatalogueRow>(sql`
      SELECT snapshot_id, manifest, coverage FROM place_catalogues
      WHERE active AND region_id IN (${V1_PLACE_REGION}, 'switzerland')
      ORDER BY CASE WHEN region_id = ${V1_PLACE_REGION} THEN 0 ELSE 1 END LIMIT 1
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
      const selectedIds =
        windows === undefined
          ? sql``
          : windows.length
            ? sql`AND id IN (
        WITH windows AS MATERIALIZED (
          SELECT ST_MakeEnvelope(w.west,w.south,w.east,w.north,4326) AS box
          FROM jsonb_to_recordset(${JSON.stringify(windows)}::jsonb) AS w(west float8,south float8,east float8,north float8)
        )
        SELECT DISTINCT hit.id FROM windows w CROSS JOIN LATERAL (
          SELECT p.id FROM places p WHERE p.retired_at IS NULL AND p.catalogue_snapshot_id=${row.snapshot_id}
            AND p.location::geometry && w.box OFFSET 0
        ) hit
      )`
            : sql`AND false`;
      if (windows !== undefined) {
        const count = (
          await tx.execute<{ count: number }>(
            sql`SELECT count(*)::integer AS count FROM places WHERE retired_at IS NULL AND catalogue_snapshot_id=${row.snapshot_id}`,
          )
        ).rows[0]?.count;
        if (count !== catalogue.manifest.counts.total)
          throw new Error('Incomplete batch catalogue');
      }
      const rows =
        windows?.length === 0
          ? []
          : (
              await tx
                .execute<PlaceRow>(
                  sql`
      SELECT id, display_name, kinds, subtypes, elevation_m,
        ST_X(location::geometry) AS longitude, ST_Y(location::geometry) AS latitude
      FROM places WHERE retired_at IS NULL AND catalogue_snapshot_id = ${row.snapshot_id}
        ${selectedIds}
      ORDER BY id
    `,
                )
                .catch(() => {
                  throw new Error('Place catalogue query failed');
                })
            ).rows;
      if (
        windows === undefined &&
        rows.length !== catalogue.manifest.counts.total
      )
        throw new Error('Incomplete batch catalogue');
      const places = rows.map((row) =>
        Object.freeze({
          id: row.id,
          displayName: row.display_name,
          kinds: Object.freeze([...row.kinds]) as CandidatePlace['kinds'],
          subtypes: Object.freeze([
            ...row.subtypes,
          ]) as CandidatePlace['subtypes'],
          location: Object.freeze({
            longitude: row.longitude,
            latitude: row.latitude,
          }),
          ...(row.elevation_m === null ? {} : { elevationM: row.elevation_m }),
        }),
      );
      freeze(catalogue);
      return Object.freeze({
        catalogue,
        places: Object.freeze(places),
        revision,
        ...(windows && {
          windows: Object.freeze(
            windows.map((window) => Object.freeze(window)),
          ),
        }),
      });
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}
