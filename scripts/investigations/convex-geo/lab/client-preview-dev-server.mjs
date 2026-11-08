// Real Next HTTP + browser proof; all identity data lives in local Docker Postgres.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

import postgres from 'postgres';

import { resolveDatabaseConnection } from '../../../../src/server/db/connection';

const require = createRequire(
  new URL('../../../../package.json', import.meta.url),
);
const { chromium } = require('playwright-core');

export async function verifyDevServer(owner) {
  const interactive = process.env.PREVIEW_DEV_INTERACTIVE === '1';
  const local = new URL(
    resolveDatabaseConnection(process.env).connectionString,
  );
  assert(
    ['localhost', '127.0.0.1', 'db.localtest.me'].includes(local.hostname),
  );
  assert.equal(local.pathname, '/main');
  assert.equal(local.port || '5432', '5432');
  local.hostname = '127.0.0.1';
  const sql = postgres(local.toString(), { max: 1, prepare: false });
  const token = randomBytes(32).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  const signed = encodeURIComponent(`${token}.${signature}`);
  const origin = 'http://127.0.0.1:3100';
  const cookie = { Cookie: `better-auth.session_token=${signed}` };
  const bearer = { Authorization: `Bearer ${signed}` };
  const results = new URL('./results/dev-server-preview/', import.meta.url);
  await mkdir(results, { recursive: true });
  let server;
  let browser;
  let created = false;
  let log = '';
  const checks = [];
  try {
    await sql`insert into "user" (id, name, email, athlete_id)
      values (${owner.userId}, 'Convex web fixture', ${owner.userId + '@example.invalid'}, ${owner.athleteId})`;
    created = true;
    await sql`insert into session (id, token, "userId", "expiresAt")
      values (${randomUUID()}, ${token}, ${owner.userId}, ${new Date(Date.now() + (interactive ? 8 * 60 : 30) * 60_000)})`;
    server = spawn(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'dev',
        ...(process.env.PREVIEW_DEV_BUNDLER === 'webpack' ? ['--webpack'] : []),
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
          DATABASE_URL:
            'postgres://postgres:postgres@db.localtest.me:5432/main',
          NEON_DATABASE_URL: '',
          BETTER_AUTH_SECRET: secret,
          AUTH_SECRET: secret,
          BETTER_AUTH_URL: origin,
          PUBLIC_URL: origin,
          NEXT_PUBLIC_APP_URL: origin,
          NEXT_PUBLIC_ENV: 'development',
          OAUTH_PROXY_SECRET: '',
          OAUTH_PROXY_PRODUCTION_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    server.stdout.on('data', (data) => {
      log += data;
    });
    server.stderr.on('data', (data) => {
      log += data;
    });
    const deadline = Date.now() + 60_000;
    while (!log.includes('Ready in')) {
      assert.equal(server.exitCode, null, 'Next dev exited before readiness');
      assert(Date.now() < deadline, 'Next dev readiness timed out');
      await sleep(250);
    }
    console.log(`Next dev ready at ${origin}; exercising real HTTP routes.`);
    async function call(
      path,
      headers = bearer,
      expected = 200,
      method = 'GET',
    ) {
      const start = performance.now();
      const response = await fetch(origin + path, {
        headers,
        method,
        signal: AbortSignal.timeout(120_000),
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      checks.push({
        path,
        status: response.status,
        ms: Math.round(performance.now() - start),
      });
      assert.equal(
        response.status,
        expected,
        `${path}: ${JSON.stringify(body)}`,
      );
      return body;
    }
    await call('/api/v1/sync/bootstrap', {}, 401);
    const bootstrap = await call('/api/v1/sync/bootstrap', cookie);
    assert.deepEqual(
      bootstrap.data.items.map((item) => item.id),
      ['1', '2'],
    );
    assert.equal(
      bootstrap.data.items.find((item) => item.id === '2').placeMatches
        .streamRevision,
      '1',
    );
    assert.deepEqual(
      (await call('/api/v1/activities')).data.items.map((item) => item.id),
      ['1', '2'],
    );
    assert.equal((await call('/api/v1/photos')).data.items.length, 1);
    await call(
      `/api/v1/sync/changes?cursor=${encodeURIComponent(bootstrap.data.snapshotCursor)}`,
    );
    const summaries = await call('/api/v1/stream-summaries/compact?ids=2');
    assert.equal(summaries.data.summaries[0].summary.codec, 'polyline-v1');
    await call('/api/v1/activities/2/streams?fetch=none');
    await call('/api/v1/activities/2/streams/summary');
    await call('/api/v1/activities/2/streams/summary/compact');
    const places = await call('/api/activities/2/places', cookie);
    assert.equal(places.activityId, '2');
    assert.equal(places.streamRevision, '1');
    assert(places.resultRevision);
    await call('/api/v1/ingestion-status');
    await call('/api/v1/activities/999/streams?fetch=none', bearer, 404);
    await call('/api/v1/activities/2/refresh', bearer, 503, 'POST');
    console.log(
      'Real HTTP passed cookie/bearer auth, bootstrap, delta, activities, photos, raw/compact streams, matching and isolation.',
    );

    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH ||
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: !interactive,
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
    const pageErrors = [];
    const consoleErrors = [];
    const failedRequests = [];
    const responses = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      failedRequests.push({
        host: url.hostname,
        path: url.pathname,
        error: request.failure()?.errorText,
      });
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname.startsWith('/api/'))
        responses.push({ path: url.pathname, status: response.status() });
    });
    await page.goto(`${origin}/list`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page
      .getByText('Original', { exact: true })
      .first()
      .waitFor({ timeout: 60_000 });
    await page.screenshot({
      path: new URL('list.png', results).pathname,
      fullPage: true,
    });
    assert.deepEqual(pageErrors, [], 'Browser runtime errors');
    assert(
      responses.some(
        (entry) =>
          entry.path === '/api/v1/sync/bootstrap' && entry.status === 200,
      ),
    );
    assert(
      !responses.some((entry) => entry.status >= 500),
      JSON.stringify(responses),
    );
    await page.goto(`${origin}/map`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page.locator('.mapboxgl-canvas').waitFor({ timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await page.screenshot({
      path: new URL('map.png', results).pathname,
      fullPage: true,
    });
    assert.deepEqual(pageErrors, [], 'Map runtime errors');
    assert.deepEqual(consoleErrors, [], 'Browser console errors');
    assert(
      !responses.some((entry) => entry.status >= 500),
      JSON.stringify(responses),
    );
    if (interactive) {
      await page.bringToFront();
      console.log(
        `Interactive Convex fixture preview open at ${origin}/map. Close its Chrome window or stop this process to clean up.`,
      );
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
      return;
    }
    await call('/api/v1/auth/logout', bearer, 200, 'POST');
    await call('/api/v1/sync/bootstrap', cookie, 401);
    await call('/api/v1/sync/bootstrap', bearer, 401);
    await writeFile(
      new URL('report.json', results),
      JSON.stringify(
        { checks, responses, pageErrors, consoleErrors, failedRequests },
        null,
        2,
      ),
    );
    console.log(
      'Next dev browser list/map, real sync traffic and logout passed. Evidence: lab/results/dev-server-preview/.',
    );
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) {
      const stopped = new Promise((resolve) => server.once('exit', resolve));
      server.kill('SIGTERM');
      await Promise.race([stopped, sleep(5_000)]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    await writeFile(new URL('server.log', results), log);
    if (created) await sql`delete from "user" where id = ${owner.userId}`;
    await sql.end({ timeout: 5 });
  }
}
