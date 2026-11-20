import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { ConvexHttpClient } from 'convex/browser';
import { parse } from 'dotenv';

// The upload is explicitly authorized and started separately. This controller
// resumes the two sequential repetitions and retains the approved source files.
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = async (url) => JSON.parse(await readFile(url, 'utf8'));
const base = new URL('./results/', import.meta.url);
const sessionURL = (repetition) =>
  new URL(`full-library-validation-${repetition}/session.json`, base);
const key = parse(
  await readFile(new URL('./.env.full-validation', import.meta.url)),
).CONVEX_DEPLOY_KEY;
assert(key?.startsWith('dev:spotted-fennec-603|'));
const client = new ConvexHttpClient('https://spotted-fennec-603.convex.cloud', {
  logger: false,
});
client.setAdminAuth(key);

async function command(script, ...args) {
  console.log(
    JSON.stringify({ stage: args.join(' '), at: new Date().toISOString() }),
  );
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        `scripts/investigations/convex-geo/lab/${script}`,
        ...args,
      ],
      { cwd: root, stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)),
    );
  });
}

if (!(await read(sessionURL(1)).catch(() => null))) {
  const session = await read(sessionURL(0));
  let ready = false;
  for (let i = 0; i < 360; i++) {
    const state = await client.query('matchingReplay:state', {
      run: session.run,
    });
    assert(state && ['loading', 'ready'].includes(state.state));
    if (state.state === 'ready') {
      ready = true;
      break;
    }
    await sleep(5000);
  }
  assert(ready, 'Upload did not become ready within 30 minutes');
  await command(
    'batch-region-study.mjs',
    'run',
    '--full-library',
    '--repetition=0',
  );
  await command(
    'batch-region-study.mjs',
    'audit',
    '--full-library',
    '--repetition=0',
  );
  await sleep(10000); // Let the execution-log stream flush before checking completeness.
  await command(
    'summarize-batch-region.mjs',
    '--full-library',
    '--repetition=0',
    '--complete',
    '--retained',
  );
  await command(
    'batch-region-study.mjs',
    'reuse',
    '--full-library',
    '--repetition=1',
  );
}
await command(
  'batch-region-study.mjs',
  'run',
  '--full-library',
  '--repetition=1',
);
await command(
  'batch-region-study.mjs',
  'audit',
  '--full-library',
  '--repetition=1',
);
await sleep(10000);
await command(
  'summarize-batch-region.mjs',
  '--full-library',
  '--repetition=1',
  '--complete',
  '--retained',
);
console.log('Full-library validation finished; approved recordings retained.');
