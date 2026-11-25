import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import postgres from 'postgres';

const directory = new URL('./results/', import.meta.url);
const sql = postgres('postgres://postgres:postgres@localhost:5432/main', {
  max: 1,
});
try {
  const result = await sql.begin(
    'isolation level repeatable read read only',
    async (tx) => {
      const [catalogue] =
        await tx`SELECT snapshot_id,manifest,coverage FROM place_catalogues WHERE active AND region_id='ch-at-it'`;
      assert(catalogue, 'Missing active CH/AT/IT catalogue');
      const rows =
        await tx`SELECT id,display_name,kinds,subtypes,elevation_m,ST_X(location::geometry) AS longitude,ST_Y(location::geometry) AS latitude FROM places WHERE retired_at IS NULL AND catalogue_snapshot_id=${catalogue.snapshot_id} ORDER BY id`;
      assert.equal(rows.length, catalogue.manifest.counts.total);
      const places = rows.map((p) => ({
        dataset: catalogue.snapshot_id,
        key: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        tile: `${Math.floor((p.longitude + 180) * 4)},${Math.floor((p.latitude + 90) * 4)}`,
        metadata: {
          id: p.id,
          displayName: p.display_name,
          kinds: p.kinds,
          subtypes: p.subtypes,
          location: { latitude: p.latitude, longitude: p.longitude },
          ...(p.elevation_m === null ? {} : { elevationM: p.elevation_m }),
        },
      }));
      return { catalogue, places };
    },
  );
  await mkdir(directory, { recursive: true });
  const data = result.places.map((p) => JSON.stringify(p)).join('\n') + '\n';
  await writeFile(new URL('places.jsonl', directory), data);
  await writeFile(
    new URL('catalogue.json', directory),
    JSON.stringify(result.catalogue),
  );
  const summary = {
    dataset: result.catalogue.snapshot_id,
    count: result.places.length,
    jsonlBytes: Buffer.byteLength(data),
    sha256: createHash('sha256').update(data).digest('hex'),
  };
  await writeFile(
    new URL('export-summary.json', directory),
    JSON.stringify(summary, null, 2),
  );
  console.log(summary);
} finally {
  await sql.end();
}
