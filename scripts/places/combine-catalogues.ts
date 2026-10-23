import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  canonicalJson,
  loadCatalogueArtifact,
  serializeCatalogueDuplicates,
  serializeCatalogueRows,
} from '../../src/server/places/catalogue-artifact';
import { combineCatalogues } from '../../src/server/places/catalogue-combine';

const { values } = parseArgs({
  options: {
    region: { type: 'string' },
    input: { type: 'string', multiple: true },
    out: { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help)
  console.log(
    'Combine aligned country catalogues, deduplicating shared OSM objects and unioning coverage:\n  pnpm places:combine --region ch-at-it --input <switzerland-artifact> --input <austria-artifact> --input <italy-artifact> --out <new-directory>',
  );
else {
  if (!values.region || !values.out || !values.input || values.input.length < 2)
    throw new Error(
      'Supply --region, --out, and at least two --input artifact directories',
    );
  const started = performance.now();
  const inputs = [];
  for (const directory of values.input)
    inputs.push(await loadCatalogueArtifact(directory));
  const catalogue = combineCatalogues(values.region, inputs);
  const output = resolve(values.out);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  try {
    const contents = {
      'places.jsonl': serializeCatalogueRows(catalogue.rows),
      'coverage.geojson': `${canonicalJson(catalogue.coverage)}\n`,
      'duplicates.jsonl': serializeCatalogueDuplicates(catalogue.duplicates!),
      'manifest.json': `${canonicalJson(catalogue.manifest)}\n`,
    };
    for (const [file, text] of Object.entries(contents)) {
      await writeFile(join(output, `${file}.tmp`), text, { flag: 'wx' });
      await rename(join(output, `${file}.tmp`), join(output, file));
    }
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
        deduplication: catalogue.manifest.deduplication,
        durationMs: Math.round(performance.now() - started),
      },
      null,
      2,
    ),
  );
}
