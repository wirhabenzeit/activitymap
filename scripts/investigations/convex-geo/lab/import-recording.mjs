import { mkdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { MAX_RECORDING_BYTES } from './recording/codec.ts';
import { importFixture } from './recording/local.mjs';

const [fixture, ...extra] = process.argv.slice(2);
if (!fixture || extra.length) {
  console.error(
    'Usage: node --import tsx import-recording.mjs <local-payload.json>',
  );
  process.exit(2);
}
const output = fileURLToPath(
  new URL('./results/imported-recordings/', import.meta.url),
);
try {
  const file = await stat(fixture);
  if (!file.isFile() || file.size > MAX_RECORDING_BYTES)
    throw new Error('Invalid fixture file');
  const input = JSON.parse(await readFile(fixture, 'utf8'));
  await mkdir(output, { recursive: true, mode: 0o700 });
  console.log(await importFixture(input, output, 'whole'));
} catch {
  console.error(
    'Import failed. Supply a valid local raw recording JSON object within the lab byte budget.',
  );
  process.exitCode = 1;
}
