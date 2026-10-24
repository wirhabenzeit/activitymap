import type { GeometryCollection } from 'geojson';

import type { CoverageGeometry } from './coverage';
import {
  type Arc,
  SpatialIndex,
  arc,
  arcDistanceM,
  combine,
  ringContains,
  subdivide,
  vector,
} from './spatial-index';

export const BATCH_DISCOVERY_VERSION = 'local-spherical-corridor-v1';

/** Each section is independent: never invent a line through a recording gap. */
export function routeSections(geometry: GeometryCollection): Arc[][] {
  return geometry.geometries.map((part) => {
    if (part.type !== 'Point' && part.type !== 'LineString')
      throw new Error('Invalid prepared geometry');
    const points = (
      part.type === 'Point' ? [part.coordinates] : part.coordinates
    ).map(vector);
    if (!points.length) throw new Error('Empty prepared section');
    return points.length === 1
      ? [arc(points[0]!, points[0]!)]
      : points.slice(1).map((p, i) => arc(points[i]!, p));
  });
}

/** Local coverage is a spherical corridor wholly inside the published region,
 * including holes. Edges are subdivided only for tight index envelopes. The
 * extra 2% + 2m conservatively accommodates ellipsoid/sphere distance variation.
 * This explicit, versioned rule replaces the projected PostGIS buffer check. */
export function createBatchCoverage(coverage: CoverageGeometry) {
  const polygons = coverage.coordinates.map((polygon) =>
    polygon.map((ring) => ring.map(vector)),
  );
  const edges: Arc[] = [];
  for (const polygon of polygons)
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const points = subdivide(ring[i - 1]!, ring[i]!);
        for (let j = 1; j < points.length; j++)
          edges.push(arc(points[j - 1]!, points[j]!));
        if (edges.length > 500_000)
          throw new Error('Coverage boundary budget exceeded');
      }
  const index = new SpatialIndex(
    edges.map((edge) => ({ box: edge.box, value: edge })),
  );
  return {
    covers(sections: Arc[][], radiusM: number): boolean {
      if (!sections.length) return false;
      const clearance = radiusM * 1.02 + 2;
      for (const section of sections) {
        const p = section[0]!.a;
        if (
          !polygons.some(
            ([outer, ...holes]) =>
              ringContains(p, outer!) &&
              !holes.some((hole) => ringContains(p, hole, true)),
          )
        )
          return false;
        for (let start = 0; start < section.length; start += 64) {
          const block = section.slice(start, start + 64);
          const nearby = index.query(
            combine(
              block.map((edge) => edge.box),
              clearance,
            ),
          );
          for (const border of nearby)
            for (const edge of block)
              if (arcDistanceM(edge, border) <= clearance) return false;
        }
      }
      return true;
    },
  };
}
