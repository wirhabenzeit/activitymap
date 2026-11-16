import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * MapLibre 6 loads its worker from a separate module file. Fixture pages are
 * single IIFE bundles served without that file, so inject a module that hands
 * MapLibre the worker as a Blob URL before any map is created.
 *
 * Pass the returned path to esbuild's `inject` option.
 */
export async function maplibreFixtureWorker(dir) {
  // MapLibre 6 is ESM-only, so `require.resolve` can't find it.
  const entry = fileURLToPath(import.meta.resolve('maplibre-gl'));
  const worker = await readFile(
    join(entry, '..', 'maplibre-gl-worker.mjs'),
    'utf8',
  );
  const path = join(dir, 'maplibre-fixture-worker.js');
  await writeFile(
    path,
    `import { setWorkerUrl } from ${JSON.stringify(entry)};\n` +
      `setWorkerUrl(URL.createObjectURL(new Blob([${JSON.stringify(worker)}], { type: 'text/javascript' })));\n`,
  );
  return path;
}
