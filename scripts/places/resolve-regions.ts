import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { catalogueManifestSchema } from '../../src/server/places/catalogue-artifact';
import {
  convexCatalogueReader,
  readDemandTiles,
  readLiveMetadata,
  readLiveState,
} from '../../src/server/places/catalogue-reader';
import {
  datedPbfUrl,
  epochCandidates,
  fetchGeofabrikIndex,
  geofabrikFileSize,
  selectEpoch,
} from '../../src/server/places/geofabrik-index';
import {
  manifestRegions,
  regionOverridesSchema,
  resolvedRegionsDocument,
  selectRegions,
  servableRegions,
} from '../../src/server/places/region-selection';

/**
 * Choose the regions and the Geofabrik date of the next catalogue: the live
 * catalogue's regions, the regions activities are in and the override file.
 * Prints one JSON document; progress goes to stderr. The output and the logs
 * may be public: they name regions and counts only, never a tile.
 */
const { values } = parseArgs({
  options: {
    'no-demand': { type: 'boolean' },
    date: { type: 'string' },
    overrides: { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Resolve the regions and the Geofabrik date of the next catalogue:\n  pnpm places:resolve [--no-demand] [--date YYMMDD] [--overrides <file>]\nPrints { date, regions: [{ region, pbf, poly, reason }], added, skipped, counts }. A demanded region the catalogue cannot take (its coverage, or the region limit) is skipped and named. --no-demand keeps the live regions and the overrides only; --date pins the extract date; --overrides defaults to config/place-regions.json.\nRequires ACTIVITYMAP_CONVEX_SITE, ACTIVITYMAP_PLACES_KEY_ID and ACTIVITYMAP_PLACES_SIGNING_KEY (the catalogue read key).',
  );
  process.exit(0);
}
if (values.date !== undefined && !/^\d{6}$/.test(values.date))
  throw new Error('--date must be YYMMDD');
const reader = convexCatalogueReader();
if (!reader) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');

const overrides = regionOverridesSchema.parse(
  JSON.parse(
    await readFile(
      values.overrides
        ? resolve(values.overrides)
        : new URL('../../config/place-regions.json', import.meta.url),
      'utf8',
    ),
  ),
);
const metadata = await readLiveMetadata(await readLiveState(reader));
if (!metadata)
  throw new Error(
    'No live catalogue has been published yet: publish the first one by hand (docs/place-catalogue-refresh.md) before resolving regions',
  );
const live = manifestRegions(catalogueManifestSchema.parse(metadata.manifest));
console.error(`Live catalogue: ${live.length} regions`);
const index = await fetchGeofabrikIndex();
const demand = values['no-demand'] ? null : await readDemandTiles(reader);
const dates = values.date ? [values.date] : epochCandidates(new Date());

const demanded = await selectRegions({
  index,
  live,
  demand,
  overrides,
  // The newest dated file: `-latest` may redirect to a mirror.
  async sizes(extract) {
    for (const date of dates) {
      const bytes = await geofabrikFileSize(datedPbfUrl(extract, date));
      if (bytes !== null) {
        console.error(`${extract.region}: ${(bytes / 1e9).toFixed(2)} GB`);
        return bytes;
      }
    }
    throw new Error(
      `No dated extract of ${extract.region} on ${dates.join(', ')}`,
    );
  },
});
// `places:combine` needs two regions.
if (demanded.regions.length < 2)
  throw new Error('The overrides leave fewer than two regions');
const selection = servableRegions(demanded);
for (const { region, reason } of selection.skipped)
  console.error(`Skipped ${region}: ${reason}`);
console.error(
  `Regions: ${selection.regions.length} (${JSON.stringify(selection.counts)}); added: ${selection.added.join(', ') || 'none'}`,
);
const date = await selectEpoch({
  extracts: selection.regions.map(({ extract }) => extract),
  dates,
  exists: async (url) => (await geofabrikFileSize(url)) !== null,
});
console.error(`Geofabrik date: ${date}`);
console.log(JSON.stringify(resolvedRegionsDocument(selection, date), null, 2));
