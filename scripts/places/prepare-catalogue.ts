import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  canonicalJson,
  catalogueRegionSchema,
  serializeCatalogueRows,
} from '../../src/server/places/catalogue-artifact';
import { prepareCatalogue } from '../../src/server/places/catalogue-prepare';
import { CopernicusDem } from '../../src/server/places/copernicus-dem';
import { fetchGeofabrikIndex } from '../../src/server/places/geofabrik-index';

const { values } = parseArgs({
  options: {
    region: { type: 'string' },
    out: { type: 'string' },
    pbf: { type: 'string' },
    poly: { type: 'string' },
    'source-url': { type: 'string' },
    'coverage-url': { type: 'string' },
    help: { type: 'boolean' },
  },
});
function geofabrikUrl(url: string) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'download.geofabrik.de' ||
    parsed.port
  )
    throw new Error('Downloads require an HTTPS download.geofabrik.de URL');
  return parsed;
}
async function download(url: string, path: string) {
  // `-latest` redirects to the dated extract; follow only Geofabrik redirects.
  let response = await fetch(geofabrikUrl(url), {
    signal: AbortSignal.timeout(30 * 60 * 1000),
    redirect: 'manual',
  });
  for (let hops = 0; response.status >= 300 && response.status < 400; hops++) {
    const location = response.headers.get('location');
    if (!location || hops >= 3)
      throw new Error(`Download redirect failed (${response.status})`);
    const target = new URL(location, url);
    if (target.hostname !== 'download.geofabrik.de')
      throw new Error(
        'Geofabrik redirected to a mirror; download its dated extract (-YYMMDD.osm.pbf) with --source-url',
      );
    response = await fetch(geofabrikUrl(target.href), {
      signal: AbortSignal.timeout(30 * 60 * 1000),
      redirect: 'manual',
    });
  }
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status})`);
  const file = await open(path, 'wx');
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await file.writeFile(value);
    }
  } finally {
    await file.close();
  }
}
if (values.help) {
  console.log(
    `Prepare a complete regional catalogue without database credentials:\n  pnpm places:prepare --region switzerland --out output/places/switzerland-YYYY-MM-DD [--source-url <pbf> --coverage-url <poly>]\nThe region is a Geofabrik extract's region ID (as pnpm places:resolve prints it). Without --source-url and --coverage-url its URLs are read from the Geofabrik index; pass a dated --source-url (-YYMMDD.osm.pbf) to pin the epoch or when -latest redirects to a mirror. Supply --pbf and --poly together to use local source files. Pass and peak terrain is read from Copernicus GLO-30 with HTTP range requests. Runs entirely in TypeScript/Node; no external tools are required.`,
  );
} else {
  const started = performance.now();
  const region = catalogueRegionSchema.parse(values.region);
  if (!values.out) throw new Error('--out is required');
  if (!!values.pbf !== !!values.poly)
    throw new Error('Supply both --pbf and --poly, or neither');
  let sourceUrl = values['source-url'],
    coverageUrl = values['coverage-url'];
  if (!sourceUrl || !coverageUrl) {
    const extract = (await fetchGeofabrikIndex()).byRegion.get(region);
    if (!extract)
      throw new Error(
        `${region} is not in the Geofabrik index; supply --source-url and --coverage-url`,
      );
    sourceUrl ??= extract.pbf;
    coverageUrl ??= extract.poly;
  }
  const output = resolve(values.out);
  await mkdir(dirname(output), { recursive: true });
  const temporary = await mkdtemp(join(dirname(output), '.catalogue-prepare-'));
  try {
    const pbfPath = join(temporary, 'source.osm.pbf'),
      polyPath = join(temporary, 'coverage.poly');
    if (values.pbf && values.poly) {
      await copyFile(resolve(values.pbf), pbfPath);
      await copyFile(resolve(values.poly), polyPath);
    } else {
      await download(sourceUrl, pbfPath);
      await download(coverageUrl, polyPath);
    }
    const dem = new CopernicusDem();
    const catalogue = await prepareCatalogue({
      regionId: region,
      pbfPath,
      polyPath,
      sourceUrl,
      coverageUrl,
      dem,
      onProgress: (message) => console.error(message),
    });
    const artifact = join(temporary, 'artifact');
    await mkdir(artifact);
    await writeFile(
      join(artifact, 'places.jsonl'),
      serializeCatalogueRows(catalogue.rows),
    );
    await writeFile(
      join(artifact, 'coverage.geojson'),
      `${canonicalJson(catalogue.coverage)}\n`,
    );
    await writeFile(
      join(artifact, 'manifest.json'),
      `${canonicalJson(catalogue.manifest)}\n`,
    );
    // Reserve the destination exclusively, then atomically publish the manifest
    // last. Existing artifact directories are never replaced or removed.
    await mkdir(output);
    try {
      for (const name of ['places.jsonl', 'coverage.geojson', 'manifest.json'])
        await rename(join(artifact, name), join(output, name));
    } catch (error) {
      await rm(output, { recursive: true, force: true });
      throw error;
    }
    console.log(
      JSON.stringify(
        {
          directory: output,
          snapshotId: catalogue.manifest.catalogue_snapshot_id,
          counts: catalogue.manifest.counts,
          dem: dem.stats,
          durationMs: Math.round(performance.now() - started),
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
