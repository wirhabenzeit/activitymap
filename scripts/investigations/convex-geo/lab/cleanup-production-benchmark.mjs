// Run after stopping benchmark servers and revoking the temporary lab deploy key.
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';

import postgres from 'postgres';

const file = new URL('results/production-web/state.json', import.meta.url);
const state = JSON.parse(await readFile(file));
assert(/^activitymap_bench_[a-f0-9]+$/.test(state.database));
assert(
  basename(state.directory).startsWith('activitymap-production-benchmark-'),
);
assert.equal(resolve(dirname(state.directory)), resolve(tmpdir()));
const sql = postgres('postgres://postgres:postgres@127.0.0.1:5432/postgres');
try {
  // No FORCE: a still-running test server should block cleanup.
  await sql.unsafe(`DROP DATABASE IF EXISTS ${state.database}`);
} finally {
  await sql.end();
}
await rm(state.directory, { recursive: true, force: true });
await rm(new URL('.env.production-sync-proof', import.meta.url), {
  force: true,
});
await writeFile(
  file,
  JSON.stringify({ ...state, cleanedAt: new Date().toISOString() }),
  { mode: 0o600 },
);
console.log(
  'Removed only the disposable benchmark database, build and revoked-key file. Reports retained.',
);
