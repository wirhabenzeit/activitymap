import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type OsmElement,
  type Streams,
  features,
  overpassQuery,
  routePoints,
  simplify,
  suggest,
} from './matching';

const directory = path.resolve(
  process.argv[2] ?? 'output/activity-name-prototype',
);
const cacheDirectory = path.join(directory, 'osm');
await mkdir(cacheDirectory, { recursive: true });
const sample = JSON.parse(
  await readFile(path.join(directory, 'sample.json'), 'utf8'),
) as {
  selection: unknown;
  activities: {
    id: string;
    name: string;
    category: string;
    start_date: string;
    distance: number;
    total_elevation_gain: number;
  }[];
};
const results = [];
const endpoint =
  process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
for (const activity of sample.activities) {
  const { points, warnings } = routePoints(
    JSON.parse(
      await readFile(
        path.join(directory, 'routes', `${activity.id}.json`),
        'utf8',
      ),
    ) as Streams,
  );
  const query = overpassQuery(points);
  const cache = path.join(
    cacheDirectory,
    `${createHash('sha256').update(query).digest('hex')}.json`,
  );
  let osm: {
    elements: OsmElement[];
    osm3s?: { timestamp_osm_base: string };
    remark?: string;
  };
  let elapsedMs = 0;
  try {
    try {
      osm = JSON.parse(await readFile(cache, 'utf8')) as typeof osm;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const start = Date.now();
      const requestEndpoint =
        endpoint.includes('overpass.osm.ch') &&
        points.some(
          (p) => p.lat < 45.7 || p.lat > 47.9 || p.lon < 5.9 || p.lon > 10.7,
        )
          ? 'https://overpass-api.de/api/interpreter'
          : endpoint;
      const response = await fetch(requestEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'ActivityMap-name-prototype/0.1',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(55000),
      });
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      osm = (await response.json()) as typeof osm;
      if (osm.remark || !Array.isArray(osm.elements))
        throw new Error(osm.remark ?? 'Invalid Overpass response');
      elapsedMs = Date.now() - start;
      await writeFile(cache, JSON.stringify(osm));
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    const result = suggest(points, features(osm.elements), activity.category);
    result.warnings.push(...warnings);
    results.push({
      activity,
      ...result,
      queryMs: elapsedMs,
      osmTimestamp: osm.osm3s?.timestamp_osm_base,
      pointCount: points.length,
      route: simplify(points, 20),
      profile: points.filter(
        (_, index) =>
          index % Math.max(1, Math.floor(points.length / 500)) === 0,
      ),
    });
    console.log(
      JSON.stringify({
        id: activity.id,
        current: activity.name,
        suggestion: result.title,
        confidence: result.confidence,
        candidates: result.candidates.length,
        selected: result.selected.map((c) => ({
          name: c.name,
          m: Math.round(c.distanceM),
          dz: Math.round(c.elevationDifferenceM ?? NaN),
        })),
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({ id: activity.id, error: (error as Error).message }),
    );
    results.push({ activity, error: (error as Error).message });
  }
  await writeFile(
    path.join(directory, 'results.json'),
    JSON.stringify(
      {
        selection: sample.selection,
        generatedAt: new Date().toISOString(),
        algorithm: 'osm-geometry-v1',
        results,
      },
      null,
      2,
    ),
  );
}
