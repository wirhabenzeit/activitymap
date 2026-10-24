/** Mean-earth sphere used only for local discovery; visit scoring is unchanged. */
export const EARTH_RADIUS_M = 6_371_008.8;
export type Vector = readonly [number, number, number];
export type Box = { low: Vector; high: Vector };
export type Arc = { a: Vector; b: Vector; normal: Vector | null; box: Box };
const CELL_M = 2_000;
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function unit(v: Vector): Vector | null {
  const length = Math.hypot(...v);
  return length < 1e-15 ? null : [v[0] / length, v[1] / length, v[2] / length];
}
export function vector(position: readonly number[]): Vector {
  const [lon, lat] = position;
  if (
    lon === undefined ||
    lat === undefined ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    Math.abs(lon) > 180 ||
    Math.abs(lat) > 90
  )
    throw new Error('Invalid indexed location');
  const x = (lon * Math.PI) / 180,
    y = (lat * Math.PI) / 180;
  return [Math.cos(y) * Math.cos(x), Math.cos(y) * Math.sin(x), Math.sin(y)];
}
export function distanceM(a: Vector, b: Vector): number {
  return (
    2 *
    EARTH_RADIUS_M *
    Math.asin(
      Math.min(1, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2),
    )
  );
}
export function bounds(points: readonly Vector[], paddingM = 0): Box {
  const low: [number, number, number] = [Infinity, Infinity, Infinity];
  const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const point of points)
    for (const axis of [0, 1, 2] as const) {
      low[axis] = Math.min(low[axis], point[axis] * EARTH_RADIUS_M - paddingM);
      high[axis] = Math.max(
        high[axis],
        point[axis] * EARTH_RADIUS_M + paddingM,
      );
    }
  return {
    low,
    high,
  };
}
export function combine(boxes: readonly Box[], paddingM = 0): Box {
  const low: [number, number, number] = [Infinity, Infinity, Infinity];
  const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes)
    for (const axis of [0, 1, 2] as const) {
      low[axis] = Math.min(low[axis], box.low[axis] - paddingM);
      high[axis] = Math.max(high[axis], box.high[axis] + paddingM);
    }
  return {
    low,
    high,
  };
}
export function arc(a: Vector, b: Vector): Arc {
  const angle = distanceM(a, b) / EARTH_RADIUS_M;
  if (angle > Math.PI - 1e-8) throw new Error('Antipodal coverage edge');
  // The sagitta bounds every point of the minor arc relative to its chord.
  return {
    a,
    b,
    normal: unit(cross(a, b)),
    box: bounds([a, b], EARTH_RADIUS_M * (1 - Math.cos(angle / 2)) + 1e-6),
  };
}
function onArc(p: Vector, edge: Arc): boolean {
  return (
    edge.normal !== null &&
    dot(cross(edge.a, p), edge.normal) >= -1e-14 &&
    dot(cross(p, edge.b), edge.normal) >= -1e-14
  );
}
export function pointArcDistanceM(p: Vector, edge: Arc): number {
  if (edge.normal) {
    const height = dot(p, edge.normal);
    const foot = unit([
      p[0] - height * edge.normal[0],
      p[1] - height * edge.normal[1],
      p[2] - height * edge.normal[2],
    ]);
    if (foot && onArc(foot, edge))
      return EARTH_RADIUS_M * Math.asin(Math.min(1, Math.abs(height)));
  }
  return Math.min(distanceM(p, edge.a), distanceM(p, edge.b));
}
export function arcDistanceM(a: Arc, b: Arc): number {
  if (a.normal && b.normal) {
    const intersection = unit(cross(a.normal, b.normal));
    if (intersection) {
      const opposite: Vector = [
        -intersection[0],
        -intersection[1],
        -intersection[2],
      ];
      if (
        (onArc(intersection, a) && onArc(intersection, b)) ||
        (onArc(opposite, a) && onArc(opposite, b))
      )
        return 0;
    }
  }
  return Math.min(
    pointArcDistanceM(a.a, b),
    pointArcDistanceM(a.b, b),
    pointArcDistanceM(b.a, a),
    pointArcDistanceM(b.b, a),
  );
}
/** Signed winding avoids accidentally accepting the antipodal complement.
 * Published coverage has CCW outer rings and CW holes. */
export function ringContains(
  p: Vector,
  ring: readonly Vector[],
  hole = false,
): boolean {
  let winding = 0;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!,
      b = ring[i]!;
    winding += Math.atan2(
      dot(p, cross(a, b)),
      dot(a, b) - dot(p, a) * dot(p, b),
    );
  }
  return hole ? winding < -Math.PI : winding > Math.PI;
}
export function subdivide(a: Vector, b: Vector): Vector[] {
  const angle = distanceM(a, b) / EARTH_RADIUS_M;
  if (angle > Math.PI - 1e-8) throw new Error('Antipodal coverage edge');
  const count = Math.max(1, Math.ceil((angle * EARTH_RADIUS_M) / 500));
  const result = [a];
  for (let i = 1; i < count; i++) {
    const t = i / count,
      first = Math.sin((1 - t) * angle) / Math.sin(angle),
      last = Math.sin(t * angle) / Math.sin(angle);
    result.push(
      unit([
        first * a[0] + last * b[0],
        first * a[1] + last * b[1],
        first * a[2] + last * b[2],
      ])!,
    );
  }
  result.push(b);
  return result;
}
function overlaps(a: Box, b: Box): boolean {
  return [0, 1, 2].every(
    (i) => a.low[i]! <= b.high[i]! && a.high[i]! >= b.low[i]!,
  );
}
function cells(box: Box, visit: (key: string) => void): void {
  const lo = box.low.map((n) => Math.floor(n / CELL_M)),
    hi = box.high.map((n) => Math.floor(n / CELL_M));
  if (
    (hi[0]! - lo[0]! + 1) * (hi[1]! - lo[1]! + 1) * (hi[2]! - lo[2]! + 1) >
    100_000
  )
    throw new Error('Spatial window exceeds prepared-track budget');
  for (let x = lo[0]!; x <= hi[0]!; x++)
    for (let y = lo[1]!; y <= hi[1]!; y++)
      for (let z = lo[2]!; z <= hi[2]!; z++) visit(`${x},${y},${z}`);
}
/** Cartesian metres avoid longitude wrap and polar special cases. Only nearby
 * buckets are inspected; query results are deduplicated by entry identity. */
export class SpatialIndex<T> {
  private readonly grid = new Map<string, { box: Box; value: T }[]>();
  constructor(entries: readonly { box: Box; value: T }[]) {
    for (const entry of entries)
      cells(entry.box, (key) => {
        const bucket = this.grid.get(key) ?? [];
        bucket.push(entry);
        this.grid.set(key, bucket);
      });
  }
  query(box: Box): Set<T> {
    const found = new Set<T>();
    cells(box, (key) => {
      for (const entry of this.grid.get(key) ?? [])
        if (overlaps(box, entry.box)) found.add(entry.value);
    });
    return found;
  }
}
