import { type SQL, sql } from 'drizzle-orm';
import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import type { GeometryCollection } from 'geojson';
import type postgres from 'postgres';
import { z } from 'zod';

import { decodeGeographyPoint } from '~/server/db/geography-point';
import {
  type CoverageGeometry,
  parseCoverageGeometry,
} from '~/server/places/coverage';
import type {
  PlaceKind,
  PlacePoint,
  PlaceSubtype,
} from '~/server/places/types';

export type CandidatePlace = {
  id: string;
  displayName: string;
  kinds: PlaceKind[];
  subtypes: PlaceSubtype[];
  location: PlacePoint;
  elevationM?: number;
};

const position = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const part = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('Point'), coordinates: position }),
  z.strictObject({
    type: z.literal('LineString'),
    coordinates: z.array(position).min(2).max(1_000_000),
  }),
]);
const discoveryGeometry = z
  .strictObject({
    type: z.literal('GeometryCollection'),
    geometries: z.array(part).min(1).max(10_000),
  })
  .superRefine((value, context) => {
    let samples = 0;
    for (const geometry of value.geometries) {
      if (geometry.type === 'Point') {
        samples++;
      } else {
        samples += geometry.coordinates.length;
        for (let index = 1; index < geometry.coordinates.length; index++) {
          if (
            Math.abs(
              geometry.coordinates[index]![0] -
                geometry.coordinates[index - 1]![0],
            ) >= 180
          ) {
            context.addIssue({
              code: 'custom',
              message: 'Split antimeridian sections before discovery',
            });
            break;
          }
        }
      }
    }
    if (samples > 1_000_000)
      context.addIssue({
        code: 'custom',
        message: 'Too many discovery coordinates',
      });
  });

export type PlaceDiscoveryInput = {
  geometry: GeometryCollection;
  coverage: CoverageGeometry;
  radiusM: number;
  limit: number;
  catalogueSnapshotId: string;
};

type StoredCandidate = {
  id: string;
  display_name: string;
  kinds: CandidatePlace['kinds'];
  subtypes: CandidatePlace['subtypes'];
  location: string;
  elevation_m: number | null;
};

/** Spatial reads against an explicitly injected, published catalogue. */
export function createPlacesRepository(
  client: postgres.Sql,
  database: PostgresJsDatabase = drizzle(client),
) {
  return createPlaceDiscoveryRepository({
    execute: async <T extends Record<string, unknown>>(query: SQL) =>
      [...(await database.execute<T>(query))] as T[],
  });
}

/** Both application Neon transactions and the offline publisher use this SQL. */
export function createPlaceDiscoveryRepository(database: {
  execute: <T extends Record<string, unknown>>(query: SQL) => Promise<T[]>;
}) {
  return {
    async assertCatalogue(
      catalogueSnapshotId: string,
      expectedCount: number,
    ): Promise<void> {
      z.string().trim().min(1).parse(catalogueSnapshotId);
      z.number().int().positive().max(100_000).parse(expectedCount);
      const result = await database.execute<{
        total: number;
        matching: number;
      }>(sql`
        SELECT count(*)::integer AS total,
          count(*) FILTER (WHERE catalogue_snapshot_id = ${catalogueSnapshotId})::integer AS matching
        FROM places WHERE retired_at IS NULL AND catalogue_snapshot_id = ${catalogueSnapshotId}
      `);
      if (
        result[0]?.total !== expectedCount ||
        result[0].matching !== expectedCount
      ) {
        throw new Error(
          'Frozen place catalogue is missing, mixed, or has an unexpected row count',
        );
      }
    },

    discover: async (
      input: PlaceDiscoveryInput,
    ): Promise<{
      candidates: CandidatePlace[];
      covered: boolean;
      truncated: boolean;
    }> => {
      const geometry = discoveryGeometry.parse(input.geometry);
      const coverage = parseCoverageGeometry(input.coverage);
      const radiusM = z
        .number()
        .finite()
        .positive()
        .max(2_000)
        .parse(input.radiusM);
      const limit = z.number().int().positive().max(5_000).parse(input.limit);
      const snapshot = z
        .string()
        .trim()
        .min(1)
        .parse(input.catalogueSnapshotId);
      const geometryJson = JSON.stringify(geometry);
      const coverageJson = JSON.stringify(coverage);

      // Boundary distance to a union is the minimum distance to its pieces.
      // Overlapping original vertices preserve every geodesic segment exactly;
      // shorter pieces let PostGIS reject distant boundary edges cheaply.
      // Do not use these chunks for buffering: that could select a different CRS.
      const clearanceParts: typeof geometry.geometries = [];
      for (const section of geometry.geometries) {
        if (section.type === 'Point') {
          clearanceParts.push(section);
          continue;
        }
        for (
          let start = 0;
          start < section.coordinates.length - 1;
          start += 63
        ) {
          clearanceParts.push({
            type: 'LineString',
            coordinates: section.coordinates.slice(start, start + 64),
          });
        }
      }
      const clearanceJson = JSON.stringify({
        type: 'GeometryCollection',
        geometries: clearanceParts,
      });

      // ST_Buffer(geography) projects to a locally selected planar CRS and uses
      // polygonal arcs. An inscribed arc alone cannot prove coverage. Expand
      // its radius for arc approximation/projection slack, and additionally
      // require a geography interior anchor + full-route boundary clearance.
      // Each section is connected: with an interior anchor, it cannot leave
      // the region (or enter a hole) without crossing its boundary. Testing one
      // anchor avoids the expensive geography polygon/line containment test;
      // the unchanged full-route clearance check rejects every such crossing.
      // Keep the whole-section buffer check to preserve its chosen projection.
      // https://postgis.net/docs/ST_Buffer.html
      // https://postgis.net/docs/ST_Covers.html
      // https://postgis.net/docs/ST_DWithin.html
      const quarterSegments = 32;
      const expandedRadius =
        (radiusM * 1.01 + 1) / Math.cos(Math.PI / (4 * quarterSegments));
      const safetyRadius = radiusM + 0.1;
      const facts = await database.execute<{
        covered: boolean;
        catalogue_present: boolean;
      }>(sql`
        WITH region AS MATERIALIZED (
          SELECT ST_SetSRID(ST_GeomFromGeoJSON(${coverageJson}),4326) AS geom
        ), sections AS MATERIALIZED (
          SELECT (ST_Dump(ST_SetSRID(ST_GeomFromGeoJSON(${geometryJson}),4326))).geom AS geom
        ), clearance_sections AS MATERIALIZED (
          SELECT (ST_Dump(ST_SetSRID(ST_GeomFromGeoJSON(${clearanceJson}),4326))).geom::geography AS route
        )
        SELECT
          CASE WHEN NOT COALESCE((SELECT bool_and(
              ST_Covers(region.geom::geography,
                (CASE WHEN ST_GeometryType(sections.geom) = 'ST_Point'
                  THEN sections.geom ELSE ST_StartPoint(sections.geom) END)::geography)
            ) FROM sections CROSS JOIN region), false) THEN false
            WHEN EXISTS (
              SELECT 1 FROM clearance_sections CROSS JOIN region
              WHERE ST_DWithin(ST_Boundary(region.geom)::geography,
                clearance_sections.route, ${safetyRadius})
            ) THEN false
            ELSE COALESCE((SELECT bool_and(ST_Covers(region.geom,
              ST_Buffer(sections.geom::geography, ${expandedRadius}, 'quad_segs=32')::geometry)
            ) FROM sections CROSS JOIN region), false)
          END AS covered,
          EXISTS(SELECT 1 FROM places WHERE catalogue_snapshot_id = ${snapshot} AND retired_at IS NULL) AS catalogue_present
      `);
      if (!facts[0]?.catalogue_present)
        throw new Error('Requested frozen catalogue is unavailable or mixed');
      if (!facts[0].covered)
        return { candidates: [], covered: false, truncated: false };

      // One batched query over validated continuous sections. ST_DWithin keeps
      // the indexed geography column bare; duplicate hits from multiple sections
      // collapse to a single place before applying the limit + 1 sentinel.
      // OFFSET 0 preserves the correlated spatial lookup: flattening the lateral
      // query can otherwise scan all catalogue IDs before testing every section.
      const found = await database.execute<StoredCandidate>(sql`
        WITH sections AS MATERIALIZED (
          SELECT (ST_Dump(ST_SetSRID(ST_GeomFromGeoJSON(${geometryJson}),4326))).geom::geography AS route
        ), selected AS (
          SELECT DISTINCT hit.id FROM sections
          CROSS JOIN LATERAL (
            SELECT id FROM places
            WHERE catalogue_snapshot_id = ${snapshot} AND retired_at IS NULL
              AND ST_DWithin(location, sections.route, ${radiusM})
            OFFSET 0
          ) AS hit
          ORDER BY hit.id LIMIT ${limit + 1}
        )
        SELECT p.id, p.display_name, p.kinds, p.subtypes,
          p.location::text AS location, p.elevation_m
        FROM places p JOIN selected ON selected.id = p.id
        ORDER BY p.id
      `);
      return {
        candidates: found.slice(0, limit).map((row) => ({
          id: row.id,
          displayName: row.display_name,
          kinds: row.kinds,
          subtypes: row.subtypes,
          location: decodeGeographyPoint(row.location),
          ...(row.elevation_m === null ? {} : { elevationM: row.elevation_m }),
        })),
        covered: true,
        truncated: found.length > limit,
      };
    },
  };
}
