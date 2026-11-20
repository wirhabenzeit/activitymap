import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { FIXTURE_SAMPLES } from './recording/fixtures.ts';

const run = promisify(execFile);
const cwd = fileURLToPath(new URL('.', import.meta.url));
const deployment = 'spotted-fennec-603';
async function probe(fixture, guards = false) {
  const started = performance.now();
  const { stdout } = await run(
    'pnpm',
    [
      'exec',
      'convex',
      'run',
      'recordingProbe:run',
      JSON.stringify({ fixture, guards }),
      '--deployment',
      deployment,
    ],
    { cwd },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.fixture, fixture);
  assert.equal(result.guards, guards);
  assert.deepEqual(
    Object.values(result.counts),
    Array(6).fill(FIXTURE_SAMPLES[fixture]),
  );
  return { ...result, cliWallMs: performance.now() - started };
}

const rows = [];
for (const fixture of Object.keys(FIXTURE_SAMPLES)) {
  const trials = [];
  for (let i = 0; i < 3; i++) trials.push(await probe(fixture));
  rows.push({ fixture, samples: FIXTURE_SAMPLES[fixture], trials });
}
const guardTrial = await probe('small', true);
const output = new URL('./results/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(
  new URL('recording-storage-hosted.json', output),
  JSON.stringify(
    {
      evidence: 'hosted-synthetic-whole-files',
      deployment,
      rows,
      guardTrial,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Verified ${rows.length * 3} hosted round trips and one guard trial.`,
);
