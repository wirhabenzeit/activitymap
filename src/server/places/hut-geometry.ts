import { parseCoverageGeometry } from './coverage';
import type { OsmSource } from './osm-pbf';

export type HutPoint = {
  osm_type: OsmSource['osm_type'];
  osm_id: string;
  osm_version?: number;
  osm_timestamp?: string;
  status: 'valid';
  point: { lon: number; lat: number };
  point_derivation: 'osm_node' | 'validated_polygon_interior';
  geometry_type: 'Point' | 'Polygon' | 'MultiPolygon';
};
type Position = [number, number];

/** Assemble only unambiguous rings by source node identity, never coordinate
 * snapping, geometry repair or a guessed connection between separate ways. */
export function assembleRings(segments: string[][]): string[][] {
  if (segments.reduce((sum, segment) => sum + segment.length, 0) > 10_000)
    throw new Error('Hut rings exceed the supported vertex limit');
  if (!segments.length || segments.some((segment) => segment.length < 2))
    throw new Error('Empty or short hut ring member');
  const rings: string[][] = [],
    pending: string[][] = [],
    degrees = new Map<string, number>();
  for (const segment of segments) {
    if (segment[0] === segment.at(-1)) rings.push([...segment]);
    else {
      pending.push([...segment]);
      for (const id of [segment[0]!, segment.at(-1)!])
        degrees.set(id, (degrees.get(id) ?? 0) + 1);
    }
  }
  if ([...degrees.values()].some((degree) => degree !== 2))
    throw new Error('Unclosed or branching hut ring members');
  while (pending.length) {
    const chain = pending.pop()!;
    while (chain[0] !== chain.at(-1)) {
      const matches = pending.flatMap((segment, index) =>
        segment[0] === chain.at(-1) || segment.at(-1) === chain.at(-1)
          ? [index]
          : [],
      );
      if (matches.length !== 1) throw new Error('Ambiguous hut ring assembly');
      const segment = pending.splice(matches[0]!, 1)[0]!;
      if (segment.at(-1) === chain.at(-1)) segment.reverse();
      for (const id of segment.slice(1)) chain.push(id);
    }
    rings.push(chain);
  }
  if (
    rings.some((ring) => ring.length < 4 || new Set(ring.slice(0, -1)).size < 3)
  )
    throw new Error('Hut ring needs three distinct vertices');
  return rings;
}
export function hutRelationWays(source: OsmSource) {
  if (source.tags.type !== 'multipolygon')
    throw new Error('Hut relation is not a multipolygon');
  const outer: string[] = [],
    inner: string[] = [],
    seen = new Set<string>();
  for (const member of source.members ?? []) {
    if (member.type !== 'way' || !['outer', 'inner'].includes(member.role))
      throw new Error('Unsupported hut relation member type/role');
    if (seen.has(member.ref)) throw new Error('Duplicate hut member way');
    seen.add(member.ref);
    (member.role === 'outer' ? outer : inner).push(member.ref);
  }
  if (!outer.length) throw new Error('Hut multipolygon has no outer way');
  return { outer, inner };
}
function inside(point: Position, ring: number[][]) {
  let result = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!,
      b = ring[i]!;
    if (
      a[1]! > point[1] !== b[1]! > point[1] &&
      point[0] <
        a[0]! + ((point[1] - a[1]!) * (b[0]! - a[0]!)) / (b[1]! - a[1]!)
    )
      result = !result;
  }
  return result;
}

/** Use a horizontal cross-section between vertex heights and choose its widest
 * interior interval. Holes participate in the crossings. Validate the resulting
 * point independently; a bbox centre or centroid need not be inside a hut. */
export function hutInteriorPoint(
  outers: string[][],
  inners: string[][],
  locations: ReadonlyMap<string, Position>,
): Position {
  const coordinates = (ring: string[]) =>
    ring.map((id) => {
      const point = locations.get(id);
      if (!point) throw new Error(`Missing hut node position: ${id}`);
      return [...point] as Position;
    });
  const polygons = assembleRings(outers).map((ring) => [coordinates(ring)]);
  for (const ring of inners.length ? assembleRings(inners) : []) {
    const hole = coordinates(ring),
      owners = polygons.filter(([outer]) => inside(hole[0]!, outer!));
    if (owners.length !== 1)
      throw new Error('Hut inner ring must have exactly one exterior');
    owners[0]!.push(hole);
  }
  // Reuse the same robust, bounded topology checks as regional coverage. Reject
  // touching boundaries/overlaps instead of broadening support through repair.
  const geometry = parseCoverageGeometry({
    type: 'MultiPolygon',
    coordinates: polygons,
  });
  let best: Position | undefined,
    widest = -1;
  for (const polygon of geometry.coordinates) {
    const outer = polygon[0]!;
    const ys = outer.map((point) => point[1]!);
    let low = Math.min(...ys),
      high = Math.max(...ys);
    const centre = (low + high) / 2;
    for (const ring of polygon)
      for (const point of ring) {
        if (point[1]! <= centre) low = Math.max(low, point[1]!);
        else high = Math.min(high, point[1]!);
      }
    const y = (low + high) / 2,
      intersections: number[] = [];
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!,
          b = ring[i]!;
        if (
          a[1] === b[1] ||
          y < Math.min(a[1]!, b[1]!) ||
          y > Math.max(a[1]!, b[1]!)
        )
          continue;
        if ((a[1] === y && b[1]! < y) || (b[1] === y && a[1]! < y)) continue;
        intersections.push(
          a[0] === b[0]
            ? a[0]!
            : a[0]! + (y - a[1]!) / ((b[1]! - a[1]!) / (b[0]! - a[0]!)),
        );
      }
    intersections.sort((a, b) => a - b);
    if (intersections.length % 2)
      throw new Error('Invalid hut interior cross-section');
    for (let i = 0; i < intersections.length; i += 2) {
      const width = intersections[i + 1]! - intersections[i]!;
      if (width > widest && width > 0) {
        const point: Position = [
          (intersections[i]! + intersections[i + 1]!) / 2,
          y,
        ];
        if (
          !inside(point, outer) ||
          polygon.slice(1).some((hole) => inside(point, hole))
        )
          throw new Error('Hut interior point validation failed');
        widest = width;
        best = point;
      }
    }
  }
  if (!best) throw new Error('Hut polygon has no interior point');
  return best;
}

export function resolveHutPoint(
  source: OsmSource,
  ways: ReadonlyMap<string, string[]>,
  locations: ReadonlyMap<string, Position>,
): HutPoint {
  const common = {
    osm_type: source.osm_type,
    osm_id: source.osm_id,
    osm_version: source.osm_version,
    osm_timestamp: source.osm_timestamp,
    status: 'valid' as const,
  };
  if (source.osm_type === 'node') {
    if (
      !source.point ||
      !Number.isFinite(source.point.lon) ||
      !Number.isFinite(source.point.lat) ||
      Math.abs(source.point.lon) > 180 ||
      Math.abs(source.point.lat) > 90
    )
      throw new Error('Invalid hut node point');
    return {
      ...common,
      point: source.point,
      point_derivation: 'osm_node',
      geometry_type: 'Point',
    };
  }
  const getWay = (id: string) => {
    const refs = ways.get(id);
    if (!refs) throw new Error(`Missing hut member way: ${id}`);
    return refs;
  };
  let outer: string[][],
    inner: string[][] = [];
  if (source.osm_type === 'way') {
    const refs = getWay(source.osm_id);
    if (source.tags.area === 'no' || refs[0] !== refs.at(-1))
      throw new Error('Hut way is not a closed area');
    outer = [refs];
  } else {
    const members = hutRelationWays(source);
    outer = members.outer.map(getWay);
    inner = members.inner.map(getWay);
  }
  const [lon, lat] = hutInteriorPoint(outer, inner, locations);
  return {
    ...common,
    point: { lon, lat },
    point_derivation: 'validated_polygon_interior',
    geometry_type: assembleRings(outer).length > 1 ? 'MultiPolygon' : 'Polygon',
  };
}
