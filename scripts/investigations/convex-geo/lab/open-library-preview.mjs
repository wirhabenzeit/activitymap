import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

import { config as dotenv } from 'dotenv';
import postgres from 'postgres';

const require = createRequire(
  new URL('../../../../package.json', import.meta.url),
);
const { chromium } = require('playwright-core');
const benchmark = process.env.PREVIEW_BENCHMARK;
const reopen = process.env.PREVIEW_REOPEN === '1';
assert(!benchmark || /^[a-z0-9-]+$/.test(benchmark));
dotenv({ path: '.env', quiet: true });
const directory = new URL('results/real-library-preview/', import.meta.url);
const config = JSON.parse(await readFile(new URL('session.json', directory)));
assert(config.expiresAt > Date.now());
const sql = postgres('postgres://postgres:postgres@127.0.0.1:5432/main', {
  max: 1,
});
const origin = 'http://127.0.0.1:3100';
const secret = randomBytes(32).toString('hex');
const token = randomBytes(32).toString('hex');
const sessionId = randomUUID();
const signed = encodeURIComponent(
  `${token}.${createHmac('sha256', secret).update(token).digest('base64')}`,
);
let server, browser;
let log = '';
let created = false;
try {
  const [user] =
    await sql`select id, athlete_id from "user" where id = ${config.userId}`;
  assert.equal(Number(user?.athlete_id), config.athleteId);
  await sql`insert into session (id, token, "userId", "expiresAt") values
    (${sessionId}, ${token}, ${user.id}, ${new Date(Math.min(config.expiresAt, Date.now() + 8 * 60 * 60_000))})`;
  created = true;
  server = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--webpack',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3100',
    ],
    {
      cwd: new URL('../../../../', import.meta.url),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VERCEL: '',
        VERCEL_ENV: 'development',
        ACTIVITYMAP_EXTERNAL_EFFECTS: '',
        DATABASE_URL: 'postgres://postgres:postgres@db.localtest.me:5432/main',
        NEON_DATABASE_URL: '',
        BETTER_AUTH_SECRET: secret,
        AUTH_SECRET: secret,
        BETTER_AUTH_URL: origin,
        PUBLIC_URL: origin,
        NEXT_PUBLIC_APP_URL: origin,
        NEXT_PUBLIC_ENV: 'development',
        OAUTH_PROXY_SECRET: '',
        OAUTH_PROXY_PRODUCTION_URL: '',
        ACTIVITYMAP_CLIENT_BACKEND: 'convex-preview',
        ACTIVITYMAP_CONVEX_PREVIEW_OWNERS: JSON.stringify({
          [config.userId]: { key: config.key, epoch: config.epoch },
        }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const capture = (data) => {
    log += data;
  };
  server.stdout.on('data', capture);
  server.stderr.on('data', capture);
  const deadline = Date.now() + 60_000;
  while (!log.includes('Ready in')) {
    assert.equal(server.exitCode, null);
    assert(Date.now() < deadline, 'Dev server startup timed out');
    await sleep(250);
  }
  console.log(
    'Real-library dev server ready. Checking authenticated stored data.',
  );
  const call = async (path) => {
    const response = await fetch(origin + path, {
      headers: { Cookie: `better-auth.session_token=${signed}` },
      signal: AbortSignal.timeout(120_000),
    });
    assert.equal(response.status, 200, path);
    return response.json();
  };
  const sample = config.sampleActivityId;
  const places = await call(`/api/activities/${sample}/places`);
  assert.equal(places.userId, config.userId);
  assert(places.places.length > 0);
  const compact = await call(`/api/v1/stream-summaries/compact?ids=${sample}`);
  assert.equal(compact.data.summaries[0].activity_id, sample);
  await call(`/api/v1/activities/${sample}/streams?fetch=none`);
  const unauth = await fetch(`${origin}/api/v1/sync/bootstrap`);
  assert.equal(unauth.status, 401);
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: Boolean(benchmark),
    handleSIGINT: false,
    handleSIGTERM: false,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: signed,
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  const errors = [];
  const responses = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith('/api/'))
      responses.push({ path: url.pathname, status: response.status() });
  });
  const started = performance.now();
  await page.goto(`${origin}/list`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  // Inspect the production IndexedDB cache, not a separate test sync client.
  async function cacheState() {
    return page.evaluate(async (userId) => {
      const entries = await indexedDB.databases();
      if (!entries.some((db) => db.name === 'activitymap-sync-v1'))
        return { count: 0 };
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('activitymap-sync-v1');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const tx = db.transaction(['activities', 'sync_state'], 'readonly');
      const read = (name) =>
        new Promise((resolve, reject) => {
          const r = tx.objectStore(name).getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      const [rows, states] = await Promise.all([
        read('activities'),
        read('sync_state'),
      ]);
      db.close();
      const scope = `auth:${userId}`;
      const own = rows.filter((row) => row.scope === scope);
      return {
        count: own.length,
        withStreams: own.filter((row) => row.data.streams?.state === 'current')
          .length,
        withMatches: own.filter(
          (row) => row.data.placeMatches?.userId === userId,
        ).length,
        state: states.find((row) => row.scope === scope),
        ids: own.map((row) => row.id),
      };
    }, config.userId);
  }
  let cached;
  let lastCount = -1;
  const syncDeadline = Date.now() + 300_000;
  while (Date.now() < syncDeadline) {
    cached = await cacheState();
    if (cached.count !== lastCount) {
      console.log(`Browser library ${cached.count}/${config.count}`);
      lastCount = cached.count;
    }
    if (cached.count === config.count && cached.state?.bootstrapComplete) break;
    assert.deepEqual(errors, []);
    assert(
      !responses.some((row) => row.status >= 500),
      JSON.stringify(responses.filter((row) => row.status >= 500)),
    );
    await sleep(1000);
  }
  assert.equal(
    cached.count,
    config.count,
    'Full library did not reach browser',
  );
  assert(cached.state?.bootstrapComplete);
  assert.equal(cached.withStreams, config.count);
  assert.equal(cached.withMatches, config.count);
  const syncMs = Math.round(performance.now() - started);
  const metadata = JSON.parse(
    await readFile(new URL('metadata.json', directory)),
  );
  assert.deepEqual(
    cached.ids.sort(),
    metadata.records.map((row) => row.activity.id).sort(),
  );
  let warmVisibleMs;
  let warmSyncMs;
  if (reopen) {
    const latest = metadata.records.reduce((a, b) =>
      a.activity.start_date > b.activity.start_date ? a : b,
    ).activity;
    const beforeReload = responses.length;
    const began = performance.now();
    const synced = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/sync/changes' &&
        response.status() === 200,
      { timeout: 30_000 },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByText(latest.name, { exact: true })
      .first()
      .waitFor({ timeout: 30_000 });
    warmVisibleMs = Math.round(performance.now() - began);
    await synced;
    warmSyncMs = Math.round(performance.now() - began);
    assert.equal((await cacheState()).count, config.count);
    assert(
      !responses
        .slice(beforeReload)
        .some((row) => row.path === '/api/v1/sync/bootstrap'),
      'Warm reload unexpectedly repeated bootstrap',
    );
  }
  if (!benchmark)
    await page.screenshot({
      path: new URL('list.png', directory).pathname,
      fullPage: true,
    });
  if (!benchmark) {
    await page.goto(`${origin}/map`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page.locator('.mapboxgl-canvas').waitFor({ timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
    await page.screenshot({
      path: new URL('map.png', directory).pathname,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    new URL(
      benchmark ? `browser-${benchmark}.json` : 'browser-report.json',
      directory,
    ),
    JSON.stringify(
      {
        count: cached.count,
        withStreams: cached.withStreams,
        withMatches: cached.withMatches,
        syncMs,
        warmVisibleMs,
        warmSyncMs,
        errors,
        responses,
      },
      null,
      2,
    ),
  );
  if (reopen) {
    const storageState = await context.storageState({ indexedDB: true });
    await browser.close();
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH ||
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: false,
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    const visible = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 1000 },
    });
    const display = await visible.newPage();
    await display.goto(`${origin}/map`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await display.locator('.mapboxgl-canvas').waitFor({ timeout: 60_000 });
    await display.bringToFront();
  }
  if (!benchmark) await page.bringToFront();
  console.log(
    `REAL LIBRARY READY: ${cached.count} activities, recordings and place results verified in the browser. ${origin}/map`,
  );
  console.log(
    JSON.stringify({
      benchmark: benchmark ?? 'interactive',
      syncMs,
      warmVisibleMs,
      warmSyncMs,
    }),
  );
  if (!benchmark || reopen)
    await new Promise((resolve) => {
      const stop = () => {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        browser.off('disconnected', stop);
        server.off('exit', stop);
        resolve();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      browser.once('disconnected', stop);
      server.once('exit', stop);
    });
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([stopped, sleep(5000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await writeFile(
    new URL(benchmark ? `server-${benchmark}.log` : 'server.log', directory),
    log,
  );
  if (created)
    await sql`delete from session where id = ${sessionId} and token = ${token}`;
  await sql.end();
}
