import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import postgres from 'postgres';

export const results = new URL('results/production-web/', import.meta.url);
export const state = JSON.parse(await readFile(new URL('state.json', results)));
assert(/^activitymap_bench_[a-f0-9]+$/.test(state.database));
export const sql = postgres(
  `postgres://postgres:postgres@127.0.0.1:5432/${state.database}`,
  { max: 3 },
);
export const real = JSON.parse(
  await readFile(
    new URL('results/real-library-preview/session.json', import.meta.url),
  ),
);

export async function startServer({ backend, owner = real, tag, port = 3101 }) {
  const origin = `http://localhost:${port}`;
  const secret = randomBytes(32).toString('hex');
  const token = randomBytes(32).toString('hex');
  const id = randomUUID();
  const signed = encodeURIComponent(
    `${token}.${createHmac('sha256', secret).update(token).digest('base64')}`,
  );
  await sql`insert into session (id,token,"userId","expiresAt") values (${id},${token},${owner.userId},${new Date(Date.now() + 3_600_000)})`;
  const server = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: state.directory,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        VERCEL: '',
        VERCEL_ENV: backend === 'convex' ? 'preview' : '',
        SKIP_ENV_VALIDATION: '1',
        ACTIVITYMAP_EXTERNAL_EFFECTS: '',
        AUTH_STRAVA_ID: 'benchmark-inert',
        AUTH_STRAVA_SECRET: 'benchmark-inert',
        OAUTH_PROXY_SECRET: '',
        OAUTH_PROXY_PRODUCTION_URL: '',
        DATABASE_URL: `postgres://postgres:postgres@db.localtest.me:5432/${state.database}`,
        NEON_DATABASE_URL: '',
        NEON_DATABASE_URL_UNPOOLED: `postgres://postgres:postgres@db.localtest.me:5432/${state.database}`,
        AUTH_SECRET: secret,
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: origin,
        PUBLIC_URL: origin,
        ACTIVITYMAP_CLIENT_BACKEND:
          backend === 'convex' ? 'convex-preview' : 'postgres',
        ACTIVITYMAP_CONVEX_PREVIEW_OWNERS: JSON.stringify({
          [owner.userId]: { key: owner.key, epoch: owner.epoch },
        }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  server.stdout.on('data', (data) => {
    log += data;
  });
  server.stderr.on('data', (data) => {
    log += data;
  });
  const deadline = Date.now() + 30_000;
  while (!log.includes('Ready in')) {
    assert.equal(server.exitCode, null, log);
    assert(Date.now() < deadline, 'Production server startup timed out');
    await sleep(100);
  }
  const headers = { Authorization: `Bearer ${signed}` };
  const check = await fetch(origin + '/api/v1/sync/bootstrap?limit=1', {
    headers,
  });
  if (check.status !== 200) {
    const body = await check.text();
    server.kill('SIGTERM');
    await writeFile(new URL(`${tag}-server.log`, results), log, {
      mode: 0o600,
    });
    await sql`delete from session where id=${id}`;
    throw new Error(`Production preflight ${check.status}: ${body}; ${log}`);
  }
  return {
    origin,
    headers,
    owner,
    async authenticate(context) {
      // Production secure cookies need HTTPS. Exercise the supported signed
      // bearer path on loopback, scoped strictly to this local server.
      await context.route(origin + '/**', (route) =>
        route.continue({
          headers: { ...route.request().headers(), ...headers },
        }),
      );
    },
    async close() {
      if (server.exitCode === null) {
        const stopped = new Promise((resolve) => server.once('exit', resolve));
        server.kill('SIGTERM');
        await stopped;
      }
      await writeFile(new URL(`${tag}-server.log`, results), log, {
        mode: 0o600,
      });
      await sql`delete from session where id=${id}`;
    },
  };
}

export async function cacheState(page, userId) {
  return page.evaluate(async (userId) => {
    if (
      !(await indexedDB.databases()).some(
        (db) => db.name === 'activitymap-sync-v1',
      )
    )
      return { count: 0 };
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('activitymap-sync-v1');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction(
      ['activities', 'photos', 'sync_state'],
      'readonly',
    );
    const read = (name) =>
      new Promise((resolve, reject) => {
        const r = tx.objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const [activities, photos, states] = await Promise.all(
      ['activities', 'photos', 'sync_state'].map(read),
    );
    db.close();
    const scope = `auth:${userId}`;
    const own = activities.filter((row) => row.scope === scope);
    return {
      count: own.length,
      ids: own.map((row) => row.id).sort(),
      photos: photos.filter((row) => row.scope === scope).length,
      withStreams: own.filter((row) => row.data.streams?.state === 'current')
        .length,
      withMatches: own.filter((row) => row.data.placeMatches?.userId === userId)
        .length,
      state: states.find((row) => row.scope === scope),
    };
  }, userId);
}

export function instrumentBrowser() {
  performance.setResourceTimingBufferSize(5000);
  window.benchmark = { transactions: [], json: [], longTasks: [] };
  const original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = original.apply(this, args);
    if (args[1] === 'readwrite') {
      const began = performance.now();
      tx.addEventListener('complete', () =>
        window.benchmark.transactions.push({
          db: this.name,
          stores: Array.from(tx.objectStoreNames),
          start: began,
          end: performance.now(),
        }),
      );
    }
    return tx;
  };
  const json = Response.prototype.json;
  Response.prototype.json = async function (...args) {
    const start = performance.now();
    try {
      return await json.apply(this, args);
    } finally {
      window.benchmark.json.push({
        url: this.url,
        start,
        end: performance.now(),
      });
    }
  };
  new PerformanceObserver((list) =>
    window.benchmark.longTasks.push(
      ...list
        .getEntries()
        .map((e) => ({ start: e.startTime, duration: e.duration })),
    ),
  ).observe({ type: 'longtask', buffered: true });
}
