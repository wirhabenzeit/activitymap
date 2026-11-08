import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parse } from 'dotenv';

const root = new URL('../../../../', import.meta.url).pathname;
const results = new URL('results/production-web/', import.meta.url);
const { directory, database } = JSON.parse(
  await readFile(new URL('state.json', results)),
);
const gallery =
  'ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';
await mkdir(dirname(join(directory, gallery)), { recursive: true });
await copyFile(join(root, gallery), join(directory, gallery));
const env = parse(await readFile(join(root, '.env')));
const buildEnv = {
  ...process.env,
  ...env,
  NODE_ENV: 'production',
  VERCEL: '',
  VERCEL_ENV: '',
  ACTIVITYMAP_EXTERNAL_EFFECTS: '',
  DATABASE_URL: `postgres://postgres:postgres@db.localtest.me:5432/${database}`,
  NEON_DATABASE_URL: '',
  NEXT_PUBLIC_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
};
const build = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'build', '--webpack'],
  { cwd: directory, env: buildEnv, stdio: ['ignore', 'pipe', 'pipe'] },
);
let log = '';
build.stdout.on('data', (data) => {
  log += data;
  process.stdout.write(data);
});
build.stderr.on('data', (data) => {
  log += data;
  process.stderr.write(data);
});
const code = await new Promise((resolve) => build.on('exit', resolve));
await writeFile(new URL('build.log', results), log);
assert.equal(code, 0, 'Production build failed; see private build.log');
console.log('Production benchmark build ready.');
