import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, arch, cpus } from 'node:os';
// Browser integration against production persistence/coordinator modules.
// No Next server, authentication, production data, or Strava requests are used.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || '/tmp/activitymap-summary-sync');
await mkdir(output, { recursive: true });
const require = createRequire(root + '/package.json');
const { chromium } = require('playwright-core');
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = await build({
  stdin: {
    contents: `
import * as store from '${root}/src/lib/sync/v1-store.ts';
import * as sync from '${root}/src/lib/sync/stream-summary-sync.ts';
import * as summary from '${root}/src/lib/activity-stream-summary.ts';
import { compactStreamCorpus } from '${root}/scripts/fixtures/compact-stream-corpus.ts';
import { encodeStreamSummary } from '${root}/src/lib/streams/compact-summary.ts';
const metadata = {generation:'00000000-0000-4000-8000-000000000001',revision:'1',state:'current',fetch_status:'success',available_types:['distance','altitude'],fetched_at:'2026-10-10T00:00:00.000Z',expires_at:null};
const corpus = compactStreamCorpus().map(v=>encodeStreamSummary(v.summary));
window.harness = {store,sync,summary,metadata,corpus, activity:(id='1',streams=metadata)=>({id,streams,start_date:'2026-10-10T00:00:00.000Z'}), record:(id='1',streams=metadata)=>({data:{activity_id:id,metadata:streams,summary:corpus[0],last_error:null,next_retry_at:null},requestedAgainst:streams})};
`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'browser',
  write: false,
  tsconfig: root + '/tsconfig.json',
});
const server = createServer((req, res) => {
  res.setHeader(
    'Content-Type',
    req.url === '/bundle.js' ? 'text/javascript' : 'text/html',
  );
  res.end(
    req.url === '/bundle.js'
      ? bundle.outputFiles[0].contents
      : '<html><body>Summary browser integration harness<script src="/bundle.js"></script></body></html>',
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port;
let browser;
const results = [];
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => !!window.harness);
  await page.evaluate(async () => {
    const r = indexedDB.open('activitymap-sync-v1', 1);
    await new Promise((resolve, reject) => {
      r.onupgradeneeded = () => {
        for (const s of ['activities', 'photos']) {
          const store = r.result.createObjectStore(s, { keyPath: 'pk' });
          store.createIndex('by_scope', 'scope');
        }
        r.result.createObjectStore('sync_state', { keyPath: 'scope' });
      };
      r.onerror = () => reject(r.error);
      r.onsuccess = resolve;
    });
    const tx = r.result.transaction(['activities', 'sync_state'], 'readwrite');
    tx.objectStore('activities').put({
      pk: 'auth:review:1',
      scope: 'auth:review',
      id: '1',
      data: window.harness.activity(),
    });
    tx.objectStore('sync_state').put({
      scope: 'auth:review',
      bootstrapComplete: true,
      changesCursor: 'cursor',
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    r.result.close();
  });
  assert.equal(
    await page.evaluate(async () => {
      const h = window.harness;
      const a = await h.store.getCachedActivityDTOs('auth:review');
      const c = await h.store.getV1SyncState('auth:review');
      return a.length === 1 && c.changesCursor === 'cursor';
    }),
    true,
  );
  results.push('v1→v2 migration preserves activity and checkpoint');
  await page.evaluate(() =>
    window.harness.store.putCachedStreamSummaries(
      'auth:review',
      [window.harness.record()],
      () => true,
    ),
  );
  await page.reload();
  await page.waitForFunction(() => !!window.harness);
  await context.setOffline(true);
  const profile = await page.evaluate(async () => {
    const h = window.harness;
    let requests = 0;
    const r = await h.sync.loadActivityStreamSummary({
      userId: 'review',
      activityId: '1',
      observedMetadata: h.metadata,
      signal: new AbortController().signal,
      fetchImpl: async () => {
        requests++;
        throw Error('unexpected network');
      },
    });
    return {
      requests,
      count: h.summary.toElevationProfile({
        metadata: r.metadata,
        summary: r.summary,
      }).distance.length,
    };
  });
  assert.equal(profile.requests, 0);
  assert(profile.count > 1);
  results.push(
    'cold module reload + offline profile reads durable summary with zero requests',
  );
  await context.setOffline(false);
  assert.equal(
    await page.evaluate(async () => {
      const h = window.harness;
      await h.store.deleteActivityDTOsByIds('auth:review', ['1']);
      await h.store.putCachedStreamSummaries(
        'auth:review',
        [h.record()],
        () => true,
      );
      return (await h.store.getCachedStreamSummaries('auth:review', ['1']))
        .size;
    }),
    0,
  );
  results.push('tombstone blocks late summary resurrection');
  assert.equal(
    await page.evaluate(async () => {
      const h = window.harness;
      const m = { ...h.metadata, revision: '2' };
      await h.store.upsertActivityDTOs('auth:review', [h.activity('1', m)]);
      await h.store.putCachedStreamSummaries(
        'auth:review',
        [h.record()],
        () => true,
      );
      return (await h.store.getCachedStreamSummaries('auth:review', ['1']))
        .size;
    }),
    0,
  );
  results.push('newer activity revision blocks old response');
  assert.equal(
    await page.evaluate(async () => {
      const h = window.harness;
      await h.store.upsertActivityDTOs('auth:review', [h.activity()]);
      await h.store.putCachedStreamSummaries(
        'auth:review',
        [h.record()],
        () => false,
      );
      return (await h.store.getCachedStreamSummaries('auth:review', ['1']))
        .size;
    }),
    0,
  );
  results.push('request/session fence blocks late write');
  const tab = await context.newPage();
  await tab.goto(url);
  await tab.waitForFunction(() => !!window.harness);
  await tab.evaluate(async () => {
    const h = window.harness;
    await h.store.deleteActivityDTOsByIds('auth:review', ['1']);
  });
  assert.equal(
    await page.evaluate(async () => {
      const h = window.harness;
      await h.store.putCachedStreamSummaries(
        'auth:review',
        [h.record()],
        () => true,
      );
      return (await h.store.getCachedStreamSummaries('auth:review', ['1']))
        .size;
    }),
    0,
  );
  results.push('cross-tab tombstone blocks late write from first tab');
  await tab.close();
  const upgradeContext = await browser.newContext();
  const upgrade = await upgradeContext.newPage();
  await upgrade.goto(url);
  await upgrade.waitForFunction(() => !!window.harness);
  await upgrade.evaluate(async () => {
    const r = indexedDB.open('activitymap-sync-v1', 1);
    await new Promise((resolve) => {
      r.onupgradeneeded = () => {
        for (const name of ['activities', 'photos']) {
          const s = r.result.createObjectStore(name, { keyPath: 'pk' });
          s.createIndex('by_scope', 'scope');
        }
        r.result.createObjectStore('sync_state', { keyPath: 'scope' });
      };
      r.onsuccess = resolve;
    });
    window.oldConnection = r.result;
  });
  const blocked = await upgrade.evaluate(async () => {
    try {
      await window.harness.store.getCachedActivityDTOs('auth:review');
      return 'not rejected';
    } catch (e) {
      return e.message;
    }
  });
  assert.match(blocked, /Close other ActivityMap tabs/);
  await upgrade.evaluate(() => window.oldConnection.close());
  const recovered = await upgrade.evaluate(async () => {
    try {
      await window.harness.store.getCachedStreamSummaries('auth:review', ['1']);
      return 'ok';
    } catch (e) {
      return e.message;
    }
  });
  assert.equal(recovered, 'ok');
  results.push(
    'blocked v1 upgrade fails clearly and recovers after old tab closes',
  );
  await upgradeContext.close();
  const budget = await page.evaluate(async () => {
    const h = window.harness;
    await h.store.clearV1Scope('auth:review');
    let before = (await navigator.storage.estimate()).usage;
    const start = performance.now();
    for (let start = 0; start < 5000; start += 100) {
      const activities = Array.from({ length: 100 }, (_, i) =>
        h.activity(String(start + i + 1)),
      );
      await h.store.upsertActivityDTOs('auth:review', activities);
      const records = activities.map((a, i) => {
        const r = h.record(a.id);
        r.data.summary = h.corpus[(start + i) % h.corpus.length];
        return r;
      });
      await h.store.putCachedStreamSummaries(
        'auth:review',
        records,
        () => true,
      );
    }
    const after = (await navigator.storage.estimate()).usage;
    const readStart = performance.now();
    let count = 0;
    for (let i = 0; i < 5000; i += 100)
      count += (
        await h.store.getCachedStreamSummaries(
          'auth:review',
          Array.from({ length: 100 }, (_, j) => String(i + j + 1)),
        )
      ).size;
    return {
      count,
      writeMs: readStart - start,
      readMs: performance.now() - readStart,
      usageBefore: before,
      usageAfter: after,
      deltaBytes: after - before,
    };
  });
  assert.equal(budget.count, 5000);
  results.push('5000 encoded summary records persisted and reread');
  const report = {
    measuredAt: new Date().toISOString(),
    environment: {
      browser: 'Chromium ' + browser.version(),
      platform: platform(),
      architecture: arch(),
      cpu: cpus()[0]?.model,
    },
    results,
    profile,
    budget,
    caveats: [
      'Synthetic compactStreamCorpus fixtures, equally repeated over 5,000 activities; not a production library.',
      'Storage is navigator.storage.estimate origin usage delta including IndexedDB overhead and minimal activity rows, not exact summary bytes.',
      'Fresh isolated headless Chrome context on this Mac; latency is not an iPhone or mobile storage budget.',
      'Cold module reload verifies durable cache reuse, not service-worker support for launching the entire app offline.',
    ],
  };
  console.log(JSON.stringify(report, null, 2));
  await writeFile(
    join(output, 'verification.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
