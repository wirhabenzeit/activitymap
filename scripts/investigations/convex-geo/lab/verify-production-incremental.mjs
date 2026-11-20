// Full production UI + real HTTP + hosted fixture ingestion, never real mutations.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

import { ConvexHttpClient } from 'convex/browser';
import { parse } from 'dotenv';

import {
  cacheState,
  results,
  sql,
  startServer,
} from './production-benchmark-runtime.mjs';

const require = createRequire(
  new URL('../../../../package.json', import.meta.url),
);
const { chromium } = require('playwright-core');
const lab = new URL('./', import.meta.url);
const { CONVEX_DEPLOY_KEY: key } = parse(
  await readFile(new URL('.env.production-sync-proof', lab)),
);
const client = new ConvexHttpClient('https://spotted-fennec-603.convex.cloud', {
  logger: false,
});
client.setAdminAuth(key);
const { catalogue } = JSON.parse(
  await readFile(new URL('results/full-library-validation-1/plan.json', lab)),
);
const metadata = JSON.parse(
  await readFile(new URL('results/real-library-preview/metadata.json', lab)),
);
const owner = {
  userId: `fixture-production-sync-${randomUUID()}`,
  athleteId: 8_500_000_000_000_000 + randomBytes(4).readUInt32BE(),
  epoch: randomUUID(),
  key: randomBytes(32).toString('hex'),
};
const scope = {
  userId: owner.userId,
  athleteId: owner.athleteId,
  epoch: owner.epoch,
};
const envKey = 'ACTIVITYMAP_PREVIEW_BRIDGE_DIGESTS';
const cli = (...args) =>
  execFileSync(
    'pnpm',
    ['exec', 'convex', 'env', ...args, '--deployment', 'spotted-fennec-603'],
    { cwd: lab, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
const report = {
  baselineActivities: metadata.records.length,
  events: [],
  assertions: [],
};
const responses = [];
const errors = [];
let previous,
  account,
  registered = false,
  configured = false,
  browser,
  server,
  page,
  context;
async function until(check, label, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(label);
}
async function itemState() {
  return page.evaluate(async (userId) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('activitymap-sync-v1');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction(
      ['activities', 'stream_summaries', 'sync_state'],
      'readonly',
    );
    const scope = `auth:${userId}`;
    const get = (name, key) =>
      new Promise((resolve, reject) => {
        const r = tx.objectStore(name).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const [row, summary, state] = await Promise.all([
      get('activities', scope + ':2'),
      get('stream_summaries', scope + ':2'),
      get('sync_state', scope),
    ]);
    db.close();
    return { activity: row?.data, summary: summary?.data, state };
  }, owner.userId);
}
async function fingerprint() {
  return page.evaluate(async (userId) => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open('activitymap-sync-v1');
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction('activities', 'readonly');
    const rows = await new Promise((resolve) => {
      const r = tx.objectStore('activities').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    const data = rows
      .filter((row) => row.scope === `auth:${userId}` && row.id !== '2')
      .sort((a, b) => a.id.localeCompare(b.id));
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(data)),
    );
    return {
      count: data.length,
      hash: Array.from(new Uint8Array(digest), (v) =>
        v.toString(16).padStart(2, '0'),
      ).join(''),
    };
  }, owner.userId);
}
async function sync(label, predicate) {
  const old = (await itemState()).state.lastSyncAt;
  const before = responses.length;
  const began = performance.now();
  await page.evaluate(() =>
    window.dispatchEvent(new Event('activitymap:retry-browser-sync')),
  );
  const current = await until(async () => {
    const value = await itemState();
    return value.state.lastSyncAt !== old && predicate(value) ? value : false;
  }, label);
  const syncMs = Math.round(performance.now() - began);
  const requests = responses
    .slice(before)
    .filter((r) => r.path.includes('/sync/'));
  assert(
    requests.length > 0 &&
      requests.every(
        (r) => r.path === '/api/v1/sync/changes' && r.status === 200,
      ),
  );
  report.events.push({ label, syncMs, requests: requests.length });
  return current;
}
async function receive(version, deleted = false) {
  const value = { key: '2', version, deleted, fixture: 'typical' };
  await client.mutation('ingestionJobs:setFixture', { account, value });
  const start = performance.now();
  const receipt = `production-sync-${version}`;
  const accepted = await client.mutation('ingestionJobs:receive', {
    account,
    generation: 1,
    receipt,
    value,
  });
  assert.equal(accepted, deleted ? 'deleted' : 'queued');
  return { start, receipt, value };
}
async function published(version) {
  return until(async () => {
    const current = await client.query('matchingFixture:current', {
      account,
      key: '2',
    });
    if (!current) return false;
    const check = await client.query('matchingGroups:check', current);
    return check?.check.recordingRevision === version
      ? { ...current, ...check }
      : false;
  }, 'Recording and matching did not publish');
}
try {
  previous = cli('get', envKey);
  cli(
    'set',
    envKey,
    JSON.stringify({
      ...JSON.parse(previous || '{}'),
      [owner.userId]: createHash('sha256').update(owner.key).digest('hex'),
    }),
  );
  configured = true;
  account = await client.mutation('ingestionJobs:createAccount', {
    app: `fixture-prod-${randomUUID()}`,
    matchingCatalogue: catalogue,
    reconciliationMs: 3_600_000,
  });
  await client.mutation('preview:register', {
    ...scope,
    fixtureAccount: account,
    matchingVersion: createHash('sha256')
      .update('production-sync-fixture')
      .digest('hex'),
  });
  registered = true;
  for (let offset = 0; offset < metadata.records.length; offset += 64) {
    const activities = metadata.records
      .slice(offset, offset + 64)
      .map(({ activity }) => ({
        ...activity,
        athlete: String(owner.athleteId),
      }));
    assert(!activities.some((row) => row.id === '2'));
    await client.mutation('previewBenchmark:seed', {
      userId: owner.userId,
      epoch: owner.epoch,
      activities,
    });
  }
  console.log(
    'Seeded isolated 4,602-activity metadata library for incremental proof.',
  );
  await sql`insert into "user" (id,name,email,athlete_id) values (${owner.userId},'Production sync fixture',${owner.userId + '@example.invalid'},${owner.athleteId})`;
  server = await startServer({
    backend: 'convex',
    owner,
    tag: 'incremental',
    port: 3102,
  });
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
  });
  await server.authenticate(context);
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === server.origin && url.pathname.startsWith('/api/'))
      responses.push({ path: url.pathname, status: response.status() });
  });
  await page.goto(server.origin + '/list', { waitUntil: 'domcontentloaded' });
  await until(async () => {
    const c = await cacheState(page, owner.userId);
    return (
      c.count === metadata.records.length &&
      c.state?.bootstrapComplete &&
      c.state?.lastSyncAt
    );
  }, 'Initial full cache incomplete');
  const unchanged = await fingerprint();
  const creation = await receive(1);
  const first = await published(1);
  const publishedMs = Math.round(performance.now() - creation.start);
  await sync(
    'new activity',
    (v) =>
      v.activity?.streams?.revision === '1' &&
      v.activity.placeMatches?.resultRevision != null,
  );
  report.events.at(-1).publishedMs = publishedMs;
  await until(
    async () => (await itemState()).summary?.metadata.revision === '1',
    'Summary revision 1 was not cached',
  );
  assert.equal((await cacheState(page, owner.userId)).count, 4603);
  assert.equal(
    await client.mutation('ingestionJobs:receive', {
      account,
      generation: 1,
      receipt: creation.receipt,
      value: creation.value,
    }),
    'duplicate',
  );
  const beforeDuplicate = (await itemState()).state.changesCursor;
  await sync('duplicate receipt', () => true);
  assert.equal((await itemState()).state.changesCursor, beforeDuplicate);
  report.assertions.push(
    'Duplicate receipt leaves cursor and library unchanged',
  );
  const replacement = await receive(2);
  const second = await published(2);
  await sync(
    'updated recording and matches',
    (v) =>
      v.activity?.streams?.revision === '2' &&
      v.activity.placeMatches?.streamRevision === '2' &&
      v.activity.placeMatches.resultRevision !== String(first.check.sequence),
  );
  report.events.at(-1).publishedMs =
    Math.round(performance.now() - replacement.start) -
    report.events.at(-1).syncMs;
  await until(
    async () => (await itemState()).summary?.metadata.revision === '2',
    'Cached summary did not advance to revision 2',
  );
  report.assertions.push(
    'Recording, matching bundle and cached chart summary advance together',
  );
  const rematchStart = performance.now();
  const group = await client.mutation('matchingGroups:start', {
    run: second.run,
    mode: 'frozen',
    ordinal: 0,
    items: [second.index],
    parallelism: 1,
  });
  await until(async () => {
    const row = await client.query('matchingGroups:status', { group });
    assert(row.state !== 'failed');
    return row.state === 'complete';
  }, 'Rematch did not complete');
  const rematchMs = Math.round(performance.now() - rematchStart);
  const same = await client.query('matchingGroups:check', {
    run: second.run,
    index: second.index,
  });
  assert.equal(same.check.sequence, second.check.sequence);
  const beforeRematch = (await itemState()).state.changesCursor;
  await sync('same-input rematch', () => true);
  assert.equal((await itemState()).state.changesCursor, beforeRematch);
  report.events.at(-1).matchingMs = rematchMs;
  report.assertions.push(
    'Same-input rematch is idempotent and creates no duplicate delta',
  );
  // Browser is genuinely disconnected while the hosted recording changes.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const offlineStart = await itemState();
  const third = await receive(3);
  await published(3);
  assert.equal((await itemState()).activity.streams.revision, '2');
  assert.equal(
    (await itemState()).state.changesCursor,
    offlineStart.state.changesCursor,
  );
  await context.setOffline(false);
  const beforeReconnect = responses.length;
  const reconnectStart = performance.now();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await until(async () => {
    const row = await itemState();
    return (
      row.activity?.streams.revision === '3' &&
      row.activity.placeMatches.streamRevision === '3'
    );
  }, 'Reconnect did not catch up');
  const reconnectMs = Math.round(performance.now() - reconnectStart);
  assert(
    !responses
      .slice(beforeReconnect)
      .some((r) => r.path === '/api/v1/sync/bootstrap'),
  );
  await until(
    async () => (await itemState()).summary?.metadata.revision === '3',
    'Reconnected summary not current',
  );
  report.events.push({
    label: 'offline reconnect',
    syncMs: reconnectMs,
    offlineHeldMs: Math.round(performance.now() - third.start) - reconnectMs,
  });
  report.assertions.push(
    'Offline cache stays readable; reconnect catches up without bootstrap',
  );
  await receive(4, true);
  await sync('activity deletion', (v) => !v.activity && !v.summary);
  assert.equal((await cacheState(page, owner.userId)).count, 4602);
  assert.deepEqual(await fingerprint(), unchanged);
  report.assertions.push(
    'Deletion removes activity and summary; every other cached row is byte-for-byte unchanged',
  );
  const warm = responses.length;
  const reopenedDelta = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/sync/changes' &&
      response.status() === 200,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await until(async () => {
    const c = await cacheState(page, owner.userId);
    return c.count === 4602 && c.state.bootstrapComplete;
  }, 'Cache missing after reopen');
  await reopenedDelta;
  const latest = metadata.records.reduce((a, b) =>
    a.activity.start_date > b.activity.start_date ? a : b,
  ).activity;
  await page
    .getByText(latest.name, { exact: true })
    .first()
    .waitFor({ timeout: 10_000 });
  assert(
    !responses.slice(warm).some((r) => r.path === '/api/v1/sync/bootstrap'),
  );
  assert.deepEqual(errors, []);
  assert(
    !responses.some((r) => r.status >= 400),
    JSON.stringify(responses.filter((r) => r.status >= 400)),
  );
  report.assertions.push(
    'Production UI has no runtime errors or failed API responses',
  );
  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await writeFile(
    new URL(`${process.env.BENCHMARK_PREFIX ?? ''}incremental.json`, results),
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser?.close();
  await server?.close();
  if (registered) await client.mutation('preview:erase', scope);
  if (account) await client.mutation('ingestionJobs:revoke', { account });
  if (configured) cli('set', envKey, previous || '{}');
  await sql`delete from "user" where id=${owner.userId}`;
  await sql.end();
}
