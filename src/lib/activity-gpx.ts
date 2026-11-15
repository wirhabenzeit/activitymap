import polyline from '@mapbox/polyline';

import type { Activity } from './activity';

/** Prefer the detailed cache, falling back when it is absent or unusable. */
export function activityGPXCoordinates(
  activity: Pick<Activity, 'map_polyline' | 'map_summary_polyline'>,
): [number, number][] {
  for (const encoded of [
    activity.map_polyline,
    activity.map_summary_polyline,
  ]) {
    if (!encoded) continue;
    try {
      const coordinates = polyline.decode(encoded);
      if (
        coordinates.length &&
        coordinates.every(
          ([lat, lon]) =>
            Number.isFinite(lat) &&
            Number.isFinite(lon) &&
            Math.abs(lat) <= 90 &&
            Math.abs(lon) <= 180,
        )
      )
        return coordinates.map(([lat, lon]) => [lon, lat]);
    } catch {
      /* Try the other cached representation. */
    }
  }
  return [];
}

export type GPXPoint = [lon: number, lat: number, elevation?: number];

type ElevationSummary = {
  distance?: number[];
  altitude?: number[];
  latlng?: [number, number][];
};

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function haversine(
  [lon1, lat1]: [number, number],
  [lon2, lat2]: [number, number],
) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * Attaches elevation to a route. The stored stream summary has only a few
 * hundred samples, so its altitude is laid over the full-resolution route by
 * relative distance travelled instead of replacing the route with it. A route
 * the summary cannot be aligned to is returned without elevation.
 */
export function routeWithElevation(
  coordinates: [number, number][],
  summary: ElevationSummary | null | undefined,
): GPXPoint[] {
  const distance = summary?.distance;
  const altitude = summary?.altitude;
  const usable =
    !!distance &&
    !!altitude &&
    distance.length === altitude.length &&
    altitude.every(Number.isFinite) &&
    distance.length >= 2 &&
    distance.every(
      (value, index) => index === 0 || value >= distance[index - 1]!,
    ) &&
    distance[distance.length - 1]! > distance[0]!;

  if (!coordinates.length) {
    // No stored route (e.g. a trimmed card): fall back to the summary's own track.
    const track = summary?.latlng;
    return track && altitude?.length === track.length
      ? track.map(([lat, lon], index) => [lon, lat, round(altitude[index]!, 1)])
      : [];
  }
  if (!usable) return coordinates.map(([lon, lat]) => [lon, lat]);

  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index++)
    cumulative.push(
      cumulative[index - 1]! +
        haversine(coordinates[index - 1]!, coordinates[index]!),
    );
  const total = cumulative[cumulative.length - 1]!;
  if (!(total > 0)) return coordinates.map(([lon, lat]) => [lon, lat]);

  const start = distance[0]!;
  const span = distance[distance.length - 1]! - start;
  let segment = 0;
  return coordinates.map(([lon, lat], index) => {
    const target = start + (cumulative[index]! / total) * span;
    while (segment < distance.length - 2 && distance[segment + 1]! < target)
      segment++;
    const from = distance[segment]!;
    const width = distance[segment + 1]! - from;
    const ratio =
      width > 0 ? Math.min(1, Math.max(0, (target - from) / width)) : 0;
    const elevation =
      altitude[segment]! +
      ratio * (altitude[segment + 1]! - altitude[segment]!);
    return [lon, lat, round(elevation, 1)];
  });
}

const escapeXml = (value: string) =>
  value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });

/** A GPX 1.1 document with one track segment; `<ele>` is written when known. */
export function activityGPXDocument(options: {
  name: string;
  time: Date;
  description?: string | null;
  points: readonly GPXPoint[];
}): string {
  const name = escapeXml(options.name);
  const description = options.description
    ? `<desc>${escapeXml(options.description)}</desc>`
    : '';
  const points = options.points
    .map(([lon, lat, elevation]) => {
      const position = `lat="${round(lat, 6)}" lon="${round(lon, 6)}"`;
      return elevation === undefined
        ? `<trkpt ${position}/>`
        : `<trkpt ${position}><ele>${elevation}</ele></trkpt>`;
    })
    .join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ActivityMap" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    ${description}
    <time>${options.time.toISOString()}</time>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
      ${points}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Unique, filesystem-safe `.gpx` names that sort by date inside the archive. */
export function activityGPXFileNames(
  activities: readonly { name: string; start_date_local: Date }[],
): string[] {
  const used = new Set<string>();
  return activities.map((activity) => {
    const date = activity.start_date_local.toISOString().slice(0, 10);
    const label = String(activity.name)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100)
      .trim();
    const base = `${date} ${label || 'Activity'}`;
    let candidate = `${base}.gpx`;
    for (let copy = 2; used.has(candidate.toLowerCase()); copy++)
      candidate = `${base} (${copy}).gpx`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
