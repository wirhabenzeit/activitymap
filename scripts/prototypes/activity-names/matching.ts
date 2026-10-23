/** Experimental geometry-only matcher. Existing activity titles never enter this module. */
export type Coordinate = [number, number];
export type Stream = {
  data: number[] | Coordinate[];
  series_type?: string;
  resolution?: string;
  original_size?: number;
};
export type Streams = { latlng?: Stream; altitude?: Stream; distance?: Stream };
export type Point = { lat: number; lon: number; km: number; altitude?: number };
export type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};
export type Feature = {
  id: string;
  name: string;
  aliases: string[];
  kind: 'peak' | 'pass' | 'hut' | 'place';
  lat: number;
  lon: number;
  elevation?: number;
  tags: Record<string, string>;
};
export type Candidate = Feature & {
  distanceM: number;
  elevationDifferenceM?: number;
  km: number;
  altitude?: number;
  climbM: number;
  accepted: boolean;
  reason: string;
};
export type MatchResult = {
  title: string | null;
  confidence: 'high' | 'medium' | 'low';
  selected: Candidate[];
  candidates: Candidate[];
  startPlace?: string;
  startFeature?: Feature;
  endFeature?: Feature;
  endPlace?: string;
  loop: boolean;
  warnings: string[];
};
const rad = Math.PI / 180;
export function metres(
  a: Pick<Point, 'lat' | 'lon'>,
  b: Pick<Point, 'lat' | 'lon'>,
) {
  const x = (a.lon - b.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (a.lat - b.lat) * rad;
  return Math.hypot(x, y) * 6371000;
}
const aligned = (a: Stream, b?: Stream) =>
  !!b &&
  a.data.length === b.data.length &&
  a.series_type === b.series_type &&
  a.resolution === b.resolution &&
  a.original_size === b.original_size;
export function routePoints(streams: Streams): {
  points: Point[];
  warnings: string[];
} {
  const gps = streams.latlng;
  if (!gps || gps.data.length < 2) throw new Error('No usable GPS stream');
  const altitudeAligned = aligned(gps, streams.altitude);
  const warnings = altitudeAligned
    ? []
    : ['No aligned altitude stream: summit evidence is weaker.'];
  const points: Point[] = [];
  let km = 0;
  for (let i = 0; i < gps.data.length; i++) {
    const pair = gps.data[i];
    if (
      !Array.isArray(pair) ||
      !pair.every(Number.isFinite) ||
      Math.abs(pair[0]) > 90 ||
      Math.abs(pair[1]) > 180
    )
      throw new Error('Invalid GPS sample');
    const point: Point = { lat: pair[0], lon: pair[1], km };
    const previous = points.at(-1);
    if (previous) km += metres(previous, point) / 1000;
    point.km = km;
    const altitude = streams.altitude?.data[i];
    if (
      altitudeAligned &&
      typeof altitude === 'number' &&
      Number.isFinite(altitude)
    )
      point.altitude = altitude;
    points.push(point);
  }
  return { points, warnings };
}
// Segment projection prevents sparse GPS samples from making a visited pass appear missed.
export function projection(p: Pick<Point, 'lat' | 'lon'>, a: Point, b: Point) {
  const scaleX = Math.cos(p.lat * rad) * rad * 6371000;
  const scaleY = rad * 6371000;
  const ax = (a.lon - p.lon) * scaleX,
    ay = (a.lat - p.lat) * scaleY;
  const bx = (b.lon - p.lon) * scaleX,
    by = (b.lat - p.lat) * scaleY;
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
  );
  return { t, distanceM: Math.hypot(ax + t * dx, ay + t * dy) };
}
export function simplify(points: Point[], toleranceM = 100): Point[] {
  if (points.length <= 2) return points;
  const keep = new Set([0, points.length - 1]);
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()! as [number, number];
    let furthest = toleranceM,
      chosen = -1;
    for (let i = start + 1; i < end; i++) {
      const d = projection(points[i]!, points[start]!, points[end]!).distanceM;
      if (d > furthest) {
        furthest = d;
        chosen = i;
      }
    }
    if (chosen >= 0) {
      keep.add(chosen);
      stack.push([start, chosen], [chosen, end]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]!);
}
export function overpassQuery(points: Point[]) {
  // A bounding-box lookup is cheaper on public Overpass than a long around-linestring.
  // Exact route distance is checked locally, so nearby off-route features cannot win.
  const latitudes = points.map((p) => p.lat),
    longitudes = points.map((p) => p.lon);
  const south = Math.min(...latitudes) - 0.045,
    north = Math.max(...latitudes) + 0.045;
  const west = Math.min(...longitudes) - 0.065,
    east = Math.max(...longitudes) + 0.065;
  if (north - south > 3 || east - west > 4)
    throw new Error('Route too large for this prototype');
  const box = `${south},${west},${north},${east}`;
  return `[out:json][timeout:40];(nwr["name"]["natural"~"^(peak|saddle)$"](${box});nwr["name"]["mountain_pass"="yes"](${box});nwr["name"]["tourism"="alpine_hut"](${box});nwr["name"]["place"](${box});nwr["name"]["aerialway"="station"](${box}););out center;`;
}
export function features(elements: OsmElement[]): Feature[] {
  return elements.flatMap((e) => {
    const tags = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat,
      lon = e.lon ?? e.center?.lon;
    if (!tags.name || lat === undefined || lon === undefined) return [];
    const elevationText = tags.ele?.replace(/\s*m$/, '');
    const elevation = elevationText === undefined ? NaN : Number(elevationText);
    return [
      {
        id: `${e.type}/${e.id}`,
        name: tags.name,
        aliases: Object.entries(tags)
          .filter(([k]) =>
            /^(name:|alt_name|official_name|short_name|loc_name)/.test(k),
          )
          .flatMap(([, v]) => v.split(';')),
        kind:
          tags.mountain_pass === 'yes' || tags.natural === 'saddle'
            ? 'pass'
            : tags.natural === 'peak'
              ? 'peak'
              : tags.tourism === 'alpine_hut'
                ? 'hut'
                : 'place',
        lat,
        lon,
        elevation: Number.isFinite(elevation) ? elevation : undefined,
        tags,
      } satisfies Feature,
    ];
  });
}
function nearbyClimb(points: Point[], km: number, altitude?: number) {
  if (altitude === undefined) return 0;
  let low = altitude;
  for (const p of points)
    if (Math.abs(p.km - km) < 2 && p.altitude !== undefined)
      low = Math.min(low, p.altitude);
  return Math.max(0, altitude - low);
}
export function matchFeature(
  feature: Feature,
  points: Point[],
  category: string,
): Candidate {
  let best = {
    distanceM: Infinity,
    km: 0,
    altitude: undefined as number | undefined,
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    // Do not turn a GPS gap into evidence of crossing a summit/pass.
    if (metres(a, b) > 500) continue;
    const { t, distanceM } = projection(feature, a, b);
    if (distanceM < best.distanceM)
      best = {
        distanceM,
        km: a.km + t * (b.km - a.km),
        altitude:
          a.altitude !== undefined && b.altitude !== undefined
            ? a.altitude + t * (b.altitude - a.altitude)
            : undefined,
      };
  }
  const elevationDifferenceM =
    feature.elevation !== undefined && best.altitude !== undefined
      ? best.altitude - feature.elevation
      : undefined;
  const climbM = nearbyClimb(points, best.km, best.altitude);
  const tolerance =
    feature.kind === 'peak' ? 120 : feature.kind === 'pass' ? 140 : 220;
  const close = best.distanceM <= tolerance;
  const altitudeConsistent =
    elevationDifferenceM === undefined ||
    Math.abs(elevationDifferenceM) <= (feature.kind === 'peak' ? 90 : 100);
  const relevant =
    category === 'bike'
      ? feature.kind === 'pass' && climbM >= 100
      : feature.kind === 'peak';
  const accepted = close && altitudeConsistent && relevant;
  const reason = !close
    ? 'Too far from route'
    : !altitudeConsistent
      ? 'Elevation mismatch: route above/below feature'
      : !relevant
        ? 'Context or minor feature'
        : elevationDifferenceM === undefined
          ? 'Close to route; elevation unverified'
          : 'Close to route with consistent elevation';
  return {
    ...feature,
    ...best,
    elevationDifferenceM,
    climbM,
    accepted,
    reason,
  };
}
function nearestPlace(point: Point, candidates: Candidate[]) {
  return candidates
    .filter(
      (c) =>
        c.kind === 'place' &&
        /^(city|town|village|hamlet)$/.test(c.tags.place ?? '') &&
        metres(c, point) <= 5000,
    )
    .sort((a, b) => metres(a, point) - metres(b, point))[0];
}
function distinct(candidates: Candidate[]) {
  const output: Candidate[] = [];
  for (const c of candidates)
    if (
      !output.some(
        (p) => p.name === c.name || (p.kind === c.kind && metres(p, c) < 250),
      )
    )
      output.push(c);
  return output;
}
export function suggest(
  points: Point[],
  osm: Feature[],
  category: string,
): MatchResult {
  const coarse = simplify(points, 100);
  const corridor = osm.filter(
    (f) =>
      coarse.some(
        (b, i) => i > 0 && projection(f, coarse[i - 1]!, b).distanceM < 1600,
      ) ||
      (f.kind === 'place' &&
        (metres(f, points[0]!) < 5000 || metres(f, points.at(-1)!) < 5000)),
  );
  const candidates = corridor
    .map((f) => matchFeature(f, points, category))
    .sort((a, b) => a.km - b.km);
  const first = points[0]!,
    last = points.at(-1)!;
  const loop = metres(first, last) < 1500;
  const warnings: string[] = [];
  let selected = distinct(
    candidates
      .filter((c) => c.accepted)
      .sort(
        (a, b) =>
          (b.elevation ?? b.altitude ?? 0) - (a.elevation ?? a.altitude ?? 0),
      ),
  );
  if (category !== 'bike' && selected.length > 1) {
    const major: Candidate[] = [];
    for (const candidate of selected) {
      const minor = major.some((other) => {
        const between = points.filter(
          (p) =>
            p.km >= Math.min(candidate.km, other.km) &&
            p.km <= Math.max(candidate.km, other.km) &&
            p.altitude !== undefined,
        );
        const lowest = between.reduce(
          (min, p) => Math.min(min, p.altitude!),
          Infinity,
        );
        return (
          Math.min(candidate.altitude ?? Infinity, other.altitude ?? Infinity) -
            lowest <
          120
        );
      });
      if (!minor) major.push(candidate);
    }
    selected = major;
  }
  selected.sort((a, b) => a.km - b.km);
  const start = nearestPlace(first, candidates),
    end = nearestPlace(last, candidates);
  let title = selected.length ? selected.map((c) => c.name).join(' – ') : null;
  let confidence: MatchResult['confidence'] = selected.length
    ? selected.every(
        (c) =>
          c.distanceM < 80 &&
          c.elevationDifferenceM !== undefined &&
          Math.abs(c.elevationDifferenceM) < 60,
      )
      ? 'high'
      : 'medium'
    : 'low';
  if (!title && category === 'bike') {
    const highest = points.reduce((a, b) =>
      (b.altitude ?? -Infinity) > (a.altitude ?? -Infinity) ? b : a,
    );
    const destination = candidates
      .filter(
        (c) =>
          (c.kind === 'place' || c.kind === 'hut') && metres(c, highest) < 500,
      )
      .sort((a, b) => metres(a, highest) - metres(b, highest))[0];
    if (destination && (highest.altitude ?? 0) - (first.altitude ?? 0) > 400) {
      title = destination.name;
      selected = [destination];
      confidence = 'medium';
    } else if (start && end && start.id !== end.id && !loop)
      title = `${start.name} – ${end.name}`;
    else if (start && loop) {
      const furthest = points.reduce((a, b) =>
        metres(first, b) > metres(first, a) ? b : a,
      );
      const via = nearestPlace(furthest, candidates);
      if (via && via.id !== start.id)
        title = `${start.name} – ${via.name} – ${start.name}`;
      else title = `${start.name} loop`;
    }
  }
  if (category !== 'bike' && selected.length) {
    const highest = points.reduce(
      (max, p) => Math.max(max, p.altitude ?? -Infinity),
      -Infinity,
    );
    const selectedHeight = selected.reduce(
      (max, p) => Math.max(max, p.altitude ?? -Infinity),
      -Infinity,
    );
    if (Number.isFinite(selectedHeight) && highest - selectedHeight > 90) {
      warnings.push(
        'The matched peak is well below the highest recorded point; it may be incidental rather than the intended destination.',
      );
      confidence = 'low';
    }
  }
  if (!title)
    warnings.push('No summit/pass confidently matched; leave name unchanged.');
  if (selected.length > 4)
    warnings.push('Many candidates: needs a shorter selection.');
  return {
    title,
    confidence,
    selected,
    candidates,
    startPlace: start?.name,
    startFeature: start,
    endFeature: end,
    endPlace: end?.name,
    loop,
    warnings,
  };
}
