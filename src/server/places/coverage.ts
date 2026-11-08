import { z } from 'zod';

export type CoverageGeometry = {
  type: 'MultiPolygon';
  coordinates: number[][][][];
};

type Position = [number, number];
type Ring = Position[];
type Polygon = Ring[];

// Pairwise topology checks are deliberately bounded for regional provider files.
const MAX_VERTICES = 10_000;
const positionSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const ringSchema = z.array(positionSchema).min(4).max(MAX_VERTICES);
const geometryShape = z.strictObject({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(ringSchema).min(1)).min(1),
});

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

// Every finite binary64 value is an integer multiple of 2^-1074. This exact
// representation avoids guessing a topology when a floating determinant cancels.
function exactCoordinate(value: number): bigint {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, value);
  const encoded = bits.getBigUint64(0);
  const exponent = Number((encoded >> 52n) & 0x7ffn);
  const fraction = encoded & ((1n << 52n) - 1n);
  const magnitude =
    exponent === 0
      ? fraction
      : ((1n << 52n) | fraction) << BigInt(exponent - 1);
  return encoded >> 63n ? -magnitude : magnitude;
}

function sign(value: bigint): number {
  return value < 0n ? -1 : value > 0n ? 1 : 0;
}

function orientation(a: Position, b: Position, c: Position): number {
  const left = (a[0] - c[0]) * (b[1] - c[1]);
  const right = (a[1] - c[1]) * (b[0] - c[0]);
  const determinant = left - right;
  const errorBound = (Math.abs(left) + Math.abs(right)) * Number.EPSILON * 8;
  if (Math.abs(determinant) > errorBound) return Math.sign(determinant);

  const ax = exactCoordinate(a[0]) - exactCoordinate(c[0]);
  const ay = exactCoordinate(a[1]) - exactCoordinate(c[1]);
  const bx = exactCoordinate(b[0]) - exactCoordinate(c[0]);
  const by = exactCoordinate(b[1]) - exactCoordinate(c[1]);
  return sign(ax * by - ay * bx);
}

function withinSegmentBounds(
  point: Position,
  a: Position,
  b: Position,
): boolean {
  return (
    point[0] >= Math.min(a[0], b[0]) &&
    point[0] <= Math.max(a[0], b[0]) &&
    point[1] >= Math.min(a[1], b[1]) &&
    point[1] <= Math.max(a[1], b[1])
  );
}

function segmentsIntersect(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
): boolean {
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  )
    return false;

  const abc = orientation(a, b, c);
  const abd = orientation(a, b, d);
  const cda = orientation(c, d, a);
  const cdb = orientation(c, d, b);
  return (
    (abc === 0 && withinSegmentBounds(c, a, b)) ||
    (abd === 0 && withinSegmentBounds(d, a, b)) ||
    (cda === 0 && withinSegmentBounds(a, c, d)) ||
    (cdb === 0 && withinSegmentBounds(b, c, d)) ||
    (abc * abd < 0 && cda * cdb < 0)
  );
}

function areaSign(ring: Ring): number {
  const positions = ring.map(
    ([x, y]) => [exactCoordinate(x), exactCoordinate(y)] as const,
  );
  let area = 0n;
  for (let index = 0; index < positions.length - 1; index++) {
    const [x, y] = positions[index]!;
    const [nextX, nextY] = positions[index + 1]!;
    area += x * nextY - nextX * y;
  }
  return sign(area);
}

function insideRing(point: Position, ring: Ring): boolean {
  let winding = 0;
  for (let index = 0; index < ring.length - 1; index++) {
    const a = ring[index]!;
    const b = ring[index + 1]!;
    if (a[1] <= point[1]) {
      if (b[1] > point[1] && orientation(a, b, point) > 0) winding++;
    } else if (b[1] <= point[1] && orientation(a, b, point) < 0) {
      winding--;
    }
  }
  return winding !== 0;
}

function validateRingBoundaries(rings: Ring[]): void {
  if (rings.reduce((sum, ring) => sum + ring.length, 0) > MAX_VERTICES)
    throw new Error(`Coverage exceeds the ${MAX_VERTICES} vertex limit`);

  for (const ring of rings) {
    if (!samePosition(ring[0]!, ring[ring.length - 1]!))
      throw new Error('Coverage rings must be explicitly closed');
    const longitudes = ring.map(([longitude]) => longitude);
    if (Math.max(...longitudes) - Math.min(...longitudes) >= 180)
      throw new Error(
        'Coverage rings spanning 180 degrees must be split first',
      );
    if (areaSign(ring) === 0)
      throw new Error('Coverage rings must have nonzero area');

    const edges = ring.length - 1;
    for (let index = 0; index < edges; index++) {
      const a = ring[index]!;
      const b = ring[index + 1]!;
      if (samePosition(a, b))
        throw new Error('Coverage rings cannot contain zero-length edges');
      const c = ring[(index + 2) % edges]!;
      if (
        orientation(a, b, c) === 0 &&
        (withinSegmentBounds(c, a, b) || withinSegmentBounds(a, b, c))
      )
        throw new Error('Coverage rings cannot backtrack along an edge');

      for (let other = index + 1; other < edges; other++) {
        if (other === index + 1 || (index === 0 && other === edges - 1))
          continue;
        if (segmentsIntersect(a, b, ring[other]!, ring[other + 1]!))
          throw new Error('Coverage rings cannot self-intersect or self-touch');
      }
    }
  }

  for (let first = 0; first < rings.length; first++) {
    for (let second = first + 1; second < rings.length; second++) {
      const a = rings[first]!;
      const b = rings[second]!;
      for (let i = 0; i < a.length - 1; i++) {
        for (let j = 0; j < b.length - 1; j++) {
          if (segmentsIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!))
            throw new Error(
              'Coverage ring boundaries cannot intersect or touch',
            );
        }
      }
    }
  }
}

function finishGeometry(polygons: Polygon[]): CoverageGeometry {
  for (let index = 0; index < polygons.length; index++) {
    const [outer, ...holes] = polygons[index]!;
    for (const hole of holes) {
      if (!insideRing(hole[0]!, outer!))
        throw new Error(
          'Coverage holes must be strictly inside their exterior',
        );
    }
    for (let first = 0; first < holes.length; first++) {
      for (let second = first + 1; second < holes.length; second++) {
        if (
          insideRing(holes[first]![0]!, holes[second]!) ||
          insideRing(holes[second]![0]!, holes[first]!)
        )
          throw new Error(
            'Coverage holes cannot overlap or contain other holes',
          );
      }
    }
    for (let other = index + 1; other < polygons.length; other++) {
      const otherOuter = polygons[other]![0]!;
      if (
        insideRing(outer![0]!, otherOuter) ||
        insideRing(otherOuter[0]!, outer!)
      )
        throw new Error('Coverage exteriors must be disjoint and not nested');
    }
  }

  // GeoJSON right-hand rule, without moving vertices or altering the boundary.
  return {
    type: 'MultiPolygon',
    coordinates: polygons.map((polygon) =>
      polygon.map((ring, index) =>
        areaSign(ring) === (index === 0 ? 1 : -1) ? ring : [...ring].reverse(),
      ),
    ),
  };
}

/**
 * Validate the supported regional coverage subset of GeoJSON. Boundary contacts,
 * nested exteriors (including islands in holes), and unsplit antimeridian rings
 * are deliberately unsupported. This proves geometry, not source completeness.
 */
export function parseCoverageGeometry(input: unknown): CoverageGeometry {
  const geometry = geometryShape.parse(input);
  validateRingBoundaries(geometry.coordinates.flat());
  return finishGeometry(geometry.coordinates);
}

/**
 * Parse one Osmosis/Geofabrik .poly file into advisory coverage geometry.
 * Requires explicitly closed rings and one final END; does not repair polygons
 * or union overlapping sections. `!` sections become holes by containment.
 */
export function parseCoveragePoly(text: string): CoverageGeometry {
  if (text.length > 2_000_000)
    throw new Error('Coverage polygon file exceeds the supported size');
  const lines = text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines[0] || lines[0] === 'END')
    throw new Error('Coverage polygon file must start with a name');
  const sections: { hole: boolean; ring: Ring }[] = [];
  const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  let index = 1;
  let vertices = 0;
  while (lines[index] !== 'END') {
    const name = lines[index++];
    if (!name || name === '!')
      throw new Error(
        'Coverage polygon file is missing a section or final END',
      );
    const coordinates: number[][] = [];
    while (lines[index] !== 'END') {
      const line = lines[index++];
      if (line === undefined)
        throw new Error('Coverage polygon section is missing END');
      const parts = line.split(/\s+/);
      if (parts.length !== 2 || parts.some((part) => !number.test(part)))
        throw new Error(
          'Coverage coordinate must be a longitude/latitude pair',
        );
      coordinates.push(parts.map(Number));
      if (++vertices > MAX_VERTICES)
        throw new Error(`Coverage exceeds the ${MAX_VERTICES} vertex limit`);
    }
    index++;
    sections.push({
      hole: name.startsWith('!'),
      ring: ringSchema.parse(coordinates),
    });
  }
  if (index !== lines.length - 1)
    throw new Error('Coverage polygon file has content after the final END');
  const polygons = sections
    .filter((section) => !section.hole)
    .map(({ ring }) => [ring]);
  if (!polygons.length)
    throw new Error('Coverage polygon file requires an exterior ring');
  validateRingBoundaries(sections.map(({ ring }) => ring));
  for (const { ring, hole } of sections) {
    if (!hole) continue;
    const owners = polygons.filter(([outer]) => insideRing(ring[0]!, outer!));
    if (owners.length !== 1)
      throw new Error('Coverage hole must belong to exactly one exterior');
    owners[0]!.push(ring);
  }
  return finishGeometry(polygons);
}
