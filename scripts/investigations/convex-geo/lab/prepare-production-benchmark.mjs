// Disposable local database and source snapshot; never edits the source library.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import postgres from 'postgres';

const root = new URL('../../../../', import.meta.url).pathname;
const results = new URL('results/production-web/', import.meta.url);
await mkdir(results, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(
  join(tmpdir(), 'activitymap-production-benchmark-'),
);
const database = `activitymap_bench_${randomBytes(5).toString('hex')}`;
const state = { directory, database, createdAt: new Date().toISOString() };
await writeFile(new URL('state.json', results), JSON.stringify(state), {
  mode: 0o600,
});
const sql = postgres('postgres://postgres:postgres@127.0.0.1:5432/postgres');
await sql.unsafe(`CREATE DATABASE ${database} TEMPLATE template0`);
await sql.end();
const dump = spawn(
  'docker',
  [
    'exec',
    'activitymap-postgres-1',
    'pg_dump',
    '-U',
    'postgres',
    '--no-owner',
    '--no-privileges',
    '--exclude-schema=scratch_sn',
    '--exclude-schema=neon_control_plane',
    'main',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
const restore = spawn(
  'docker',
  [
    'exec',
    '-i',
    'activitymap-postgres-1',
    'psql',
    '-U',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
    database,
  ],
  { stdio: ['pipe', 'ignore', 'pipe'] },
);
dump.stdout.pipe(restore.stdin);
let failure = '';
dump.stderr.on('data', (data) => {
  failure += data;
});
restore.stderr.on('data', (data) => {
  failure += data;
});
const codes = await Promise.all(
  [dump, restore].map(
    (child) => new Promise((resolve) => child.on('exit', resolve)),
  ),
);
assert.deepEqual(codes, [0, 0], failure);
const copy = postgres(
  `postgres://postgres:postgres@127.0.0.1:5432/${database}`,
);
// No real credentials or sessions are used by the benchmark copy.
await copy`delete from session`;
await copy`update account set "accessToken"='benchmark-no-provider-access', access_token='benchmark-no-provider-access', "refreshToken"=null, refresh_token=null, "accessTokenExpiresAt"=now()+interval '7 days', expires_at=extract(epoch from now()+interval '7 days')::bigint`;
await copy`ANALYZE`;
await copy.end();
console.log(
  'Isolated local library copied; provider credentials replaced with inert values.',
);
execFileSync('rsync', [
  '-a',
  '--exclude=node_modules',
  '--exclude=.git',
  '--exclude=.next',
  '--exclude=.env*',
  '--exclude=ios',
  '--exclude=.quality',
  '--exclude=output',
  '--exclude=scripts/investigations',
  '--exclude=scripts/prototypes',
  root,
  directory + '/',
]);
await symlink(join(root, 'node_modules'), join(directory, 'node_modules'));
// Timing decoration exists only in the disposable build, around actual repositories.
const routePath = join(directory, 'src/app/api/v1/sync/bootstrap/route.ts');
let route = await readFile(routePath, 'utf8');
route = route.replace(
  "import { createSyncBootstrapHandler } from './handler';",
  "import { createSyncBootstrapHandler as baseHandler, type SyncBootstrapHandlerDependencies } from './handler';\n" +
    `
function createSyncBootstrapHandler(deps: SyncBootstrapHandlerDependencies) {
  const timings: string[] = [];
  const wrap = <T extends (...args: any[]) => any>(name: string, fn: T): T => (async (...args: Parameters<T>) => {
    const start = performance.now();
    try { return await fn(...args); }
    finally { timings.push(name + ';dur=' + (performance.now()-start).toFixed(2)); }
  }) as T;
  const instrumented = { ...deps,
    resolveActor: wrap('actor', deps.resolveActor),
    activitiesRepo: { findPageByAthlete: wrap('activities', deps.activitiesRepo.findPageByAthlete.bind(deps.activitiesRepo)) },
    photosRepo: { findPageByAthlete: wrap('photos', deps.photosRepo.findPageByAthlete.bind(deps.photosRepo)) },
    changesRepo: { latestSequence: wrap('head', deps.changesRepo.latestSequence.bind(deps.changesRepo)) },
    freshnessRepo: deps.freshnessRepo && { lastCompletedAt: wrap('freshness', deps.freshnessRepo.lastCompletedAt.bind(deps.freshnessRepo)) },
    placesRepo: deps.placesRepo && { sync: wrap('matches', deps.placesRepo.sync.bind(deps.placesRepo)) },
    bootstrapPage: deps.bootstrapPage && wrap('convex', deps.bootstrapPage),
  };
  return async (request: Request) => {
    const start = performance.now();
    const response = await baseHandler(instrumented)(request);
    timings.push('handler;dur=' + (performance.now()-start).toFixed(2));
    response.headers.set('Server-Timing', timings.join(', '));
    return response;
  };
}
`,
);
assert(route.includes('Server-Timing'));
await writeFile(routePath, route);
await import('./build-production-benchmark.mjs');
