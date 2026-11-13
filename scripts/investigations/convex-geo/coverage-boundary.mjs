// Run from the repository root: node --import tsx scripts/investigations/convex-geo/coverage-boundary.mjs
import assert from 'node:assert/strict';

import postgres from 'postgres';

import {
  createBatchCoverage,
  routeSections,
} from '../../../src/server/places/batch-coverage.ts';

// Synthetic fixture only; never connects to a remote database.
const sql = postgres('postgres://postgres:postgres@localhost:5432/main', {
  max: 1,
});
const coverage = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [0, -0.05],
        [0.05, -0.05],
        [0.05, 0.05],
        [0, 0.05],
        [0, -0.05],
      ],
    ],
  ],
};
const route = {
  type: 'GeometryCollection',
  geometries: [{ type: 'Point', coordinates: [305 / 111319.49079327357, 0] }],
};
try {
  const [row] = await sql.begin(
    'read only',
    async (tx) => tx`
    WITH region AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(coverage)}),4326) AS geom),
    section AS (SELECT (ST_Dump(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(route)}),4326))).geom AS geom)
    SELECT ST_Covers(region.geom::geography,section.geom::geography)
      AND NOT ST_DWithin(ST_Boundary(region.geom)::geography,section.geom::geography,300.1)
      AND ST_Covers(region.geom,ST_Buffer(section.geom::geography,
        (300*1.01+1)/cos(pi()/128),'quad_segs=32')::geometry) AS covered,
      ST_Distance(ST_Boundary(region.geom)::geography,section.geom::geography) AS clearance_m
    FROM region,section
  `,
  );
  const localCovered = createBatchCoverage(coverage).covers(
    routeSections(route),
    300,
  );
  console.log(
    JSON.stringify({
      postgisCovered: row.covered,
      localCovered,
      clearanceM: row.clearance_m,
    }),
  );
  // A characterization of an existing versioned difference, not a desired parity assertion.
  assert.equal(row.covered, true);
  assert.equal(localCovered, false);
} finally {
  await sql.end();
}
