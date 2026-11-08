import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  decodeChunks,
  decodeWhole,
  encodeChunks,
  encodeWhole,
  recordingJson,
  validateRecording,
} from './codec.ts';
import { recordingSummary } from './processing.ts';

const save = (directory, name, bytes) =>
  writeFile(join(directory, name), bytes, { mode: 0o600 });

export async function importFixture(input, output, layout) {
  const encodeStart = performance.now();
  const streams = validateRecording(input);
  const summary = recordingSummary(streams);
  const summaryJson = recordingJson(summary);
  const files = [];
  let descriptor;
  if (layout === 'whole') {
    const { file, manifest } = encodeWhole(streams);
    files.push(file);
    descriptor = manifest;
  } else if (layout === 'chunks') {
    const { headers, samples } = encodeChunks(streams);
    files.push(...headers, ...samples.map(({ file }) => file));
    descriptor = {
      codec: 'gzip-json-chunks-v1',
      headerFiles: headers.length,
      samples: samples.map(({ start, span }) => ({ start, span })),
    };
  } else {
    throw new Error('Unknown recording layout');
  }
  const manifestJson = JSON.stringify(descriptor);
  const encodeMs = performance.now() - encodeStart;
  const temporary = await mkdtemp(join(output, '.recording-'));
  try {
    const writeStart = performance.now();
    for (const [index, file] of files.entries()) {
      await save(temporary, `${index}.gz`, file);
    }
    await save(temporary, 'manifest.json', manifestJson);
    await save(temporary, 'summary.json', summaryJson);
    const writeMs = performance.now() - writeStart;
    const writePeakRssKiB = process.resourceUsage().maxRSS;
    const readStart = performance.now();
    const manifest = JSON.parse(
      await readFile(join(temporary, 'manifest.json'), 'utf8'),
    );
    const storedSummary = JSON.parse(
      await readFile(join(temporary, 'summary.json'), 'utf8'),
    );
    let restored;
    if (manifest.codec === 'gzip-json-v1') {
      restored = decodeWhole(await readFile(join(temporary, '0.gz')), manifest);
    } else {
      const headers = [];
      for (let i = 0; i < manifest.headerFiles; i++) {
        headers.push(await readFile(join(temporary, `${i}.gz`)));
      }
      const samples = [];
      for (const [index, sample] of manifest.samples.entries()) {
        samples.push({
          ...sample,
          file: await readFile(
            join(temporary, `${manifest.headerFiles + index}.gz`),
          ),
        });
      }
      restored = decodeChunks({ headers, samples });
    }
    const readDecodeMs = performance.now() - readStart;
    const readPeakRssKiB = process.resourceUsage().maxRSS;
    if (
      !isDeepStrictEqual(restored, streams) ||
      !isDeepStrictEqual(storedSummary, summary)
    )
      throw new Error('Recording or summary changed in storage');
    const published = join(output, basename(temporary).slice(1));
    await rename(temporary, published);
    return {
      published,
      measurements: {
        layout,
        fileCount: files.length,
        fileBytes: files.reduce((total, file) => total + file.length, 0),
        maxFileBytes: Math.max(...files.map((file) => file.length)),
        manifestBytes: Buffer.byteLength(manifestJson),
        summaryBytes: Buffer.byteLength(summaryJson),
        summaryFormat: summary?.codec ?? (summary ? 'json-v1' : 'unavailable'),
        encodeMs,
        writeMs,
        readDecodeMs,
        writePeakRssKiB,
        readPeakRssKiB,
      },
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
