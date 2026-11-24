import type { GeometryCollection } from 'geojson';

import type { CoverageGeometry } from './coverage';
import {
  type Arc,
  type Vector,
  arc,
  arcDistanceM,
  combine,
  overlaps,
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

/** How far a covered section must stay from the coverage boundary. The
 * extra 2% + 2m conservatively accommodates ellipsoid/sphere distance
 * variation. */
export function coverageClearanceM(radiusM: number) {
  return radiusM * 1.02 + 2;
}

/** The coverage's rings as unit vectors, for `coverageContains`. */
export function coveragePolygons(coverage: CoverageGeometry): Vector[][][] {
  return coverage.coordinates.map((polygon) =>
    polygon.map((ring) => ring.map(vector)),
  );
}

/** Whether `p` lies inside the coverage, outside its holes. */
export function coverageContains(
  polygons: readonly Vector[][][],
  p: Vector,
): boolean {
  return polygons.some(
    ([outer, ...holes]) =>
      ringContains(p, outer!) &&
      !holes.some((hole) => ringContains(p, hole, true)),
  );
}

/** The boundary's sub-arcs kept in memory before they are dropped and built
 * again where the next sections need them. */
const CACHED_ARCS = 200_000;

/** One ring segment as an arc, subdivided only for tight envelopes. */
function subArcs(a: Vector, b: Vector) {
  const points = subdivide(a, b);
  return points.slice(1).map((point, i) => arc(points[i]!, point));
}

/** Local coverage is a spherical corridor wholly inside the published region,
 * including holes, at `coverageClearanceM` from its boundary. This explicit,
 * versioned rule replaces the projected PostGIS buffer check.
 *
 * The boundary of every region is far too long to index for one match (a
 * world catalogue has millions of 500 m arcs), so only the ring segments
 * near the sections being checked are subdivided, and kept for the next
 * check. What is compared, and so the answer, is the same as with every arc
 * indexed. */
export function createBatchCoverage(coverage: CoverageGeometry) {
  const polygons = coveragePolygons(coverage);
  const segments = polygons.flatMap((polygon) =>
    polygon.flatMap((ring) =>
      ring.slice(1).map((b, i) => ({
        a: ring[i]!,
        b,
        // Holds each sub-arc's own envelope, which pads by its sagitta.
        box: combine([arc(ring[i]!, b).box], 1),
        arcs: null as Arc[] | null,
      })),
    ),
  );
  let cached = 0;
  const arcsOf = (segment: (typeof segments)[number]) => {
    if (segment.arcs) return segment.arcs;
    if (cached > CACHED_ARCS) {
      for (const other of segments) other.arcs = null;
      cached = 0;
    }
    segment.arcs = subArcs(segment.a, segment.b);
    cached += segment.arcs.length;
    return segment.arcs;
  };
  return {
    covers(sections: Arc[][], radiusM: number): boolean {
      if (!sections.length) return false;
      const clearance = coverageClearanceM(radiusM);
      const reach = combine(
        sections.flatMap((section) => section.map((edge) => edge.box)),
        clearance,
      );
      const near = segments.filter((segment) => overlaps(segment.box, reach));
      for (const section of sections) {
        if (!coverageContains(polygons, section[0]!.a)) return false;
        for (let start = 0; start < section.length; start += 64) {
          const block = section.slice(start, start + 64);
          const window = combine(
            block.map((edge) => edge.box),
            clearance,
          );
          for (const segment of near) {
            if (!overlaps(segment.box, window)) continue;
            for (const border of arcsOf(segment)) {
              if (!overlaps(border.box, window)) continue;
              for (const edge of block)
                if (arcDistanceM(edge, border) <= clearance) return false;
            }
          }
        }
      }
      return true;
    },
  };
}
