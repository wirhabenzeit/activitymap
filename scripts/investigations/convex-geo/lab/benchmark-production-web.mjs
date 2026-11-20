import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  cacheState,
  instrumentBrowser,
  real,
  results,
  sql,
  startServer,
} from './production-benchmark-runtime.mjs';

const require = createRequire(
  new URL('../../../../package.json', import.meta.url),
);
const { chromium } = require('playwright-core');
const metadata = JSON.parse(
  await readFile(
    new URL('results/real-library-preview/metadata.json', import.meta.url),
  ),
);
const expected = metadata.records.map((row) => row.activity.id).sort();
const latest = metadata.records.reduce((a, b) =>
  a.activity.start_date > b.activity.start_date ? a : b,
).activity;
const cases = process.env.BENCHMARK_CASES?.split(',') ?? [
  'convex',
  'postgres',
  'postgres-500',
];
const prefix = process.env.BENCHMARK_PREFIX ?? '';
const reports = [];
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  for (const variant of cases) {
    const server = await startServer({
      backend: variant === 'convex' ? 'convex' : 'postgres',
      tag: prefix + variant,
    });
    try {
      for (let run = 1; run <= Number(process.env.BENCHMARK_RUNS ?? 3); run++) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          serviceWorkers: 'block',
        });
        await server.authenticate(context);
        await context.addInitScript(instrumentBrowser);
        if (variant === 'postgres-500')
          await context.route('**/api/v1/sync/bootstrap?**', (route) => {
            const url = new URL(route.request().url());
            url.searchParams.set('limit', '500');
            return route.fallback({ url: url.toString() });
          });
        const page = await context.newPage();
        const errors = [];
        const responses = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('response', (response) => {
          const url = new URL(response.url());
          if (url.origin === server.origin && url.pathname.startsWith('/api/'))
            responses.push({
              path: url.pathname,
              resource: url.searchParams.get('resource'),
              status: response.status(),
              serverTiming: response.headers()['server-timing'],
              contentEncoding: response.headers()['content-encoding'],
            });
        });
        const began = performance.now();
        await page.goto(server.origin + '/list', {
          waitUntil: 'domcontentloaded',
          timeout: 120_000,
        });
        const deadline = Date.now() + 300_000;
        let cache;
        while (Date.now() < deadline) {
          cache = await cacheState(page, real.userId);
          if (
            cache.count === real.count &&
            cache.state?.bootstrapComplete &&
            cache.state?.lastSyncAt
          )
            break;
          assert.deepEqual(errors, []);
          assert(
            !responses.some((r) => r.status >= 400),
            JSON.stringify(responses.filter((r) => r.status >= 400)),
          );
          await sleep(100);
        }
        const syncMs = Math.round(performance.now() - began);
        assert.deepEqual(cache.ids, expected);
        assert(cache.state.bootstrapComplete && cache.state.lastSyncAt);
        assert.equal(cache.withStreams, real.count);
        assert.equal(cache.withMatches, real.count);
        await page
          .getByText(latest.name, { exact: true })
          .first()
          .waitFor({ timeout: 30_000 });
        const visibleMs = Math.round(performance.now() - began);
        const metrics = await page.evaluate(() => ({
          ...window.benchmark,
          now: performance.now(),
          resources: performance
            .getEntriesByType('resource')
            .filter((e) => e.name.includes('/api/v1/sync/'))
            .map((e) => e.toJSON()),
        }));
        const before = responses.length;
        const warmStart = performance.now();
        const delta = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === '/api/v1/sync/changes' &&
            r.status() === 200,
          { timeout: 30_000 },
        );
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page
          .getByText(latest.name, { exact: true })
          .first()
          .waitFor({ timeout: 30_000 });
        const warmVisibleMs = Math.round(performance.now() - warmStart);
        await delta;
        const warmSyncMs = Math.round(performance.now() - warmStart);
        assert(
          !responses
            .slice(before)
            .some((r) => r.path === '/api/v1/sync/bootstrap'),
        );
        assert.deepEqual(errors, []);
        const report = {
          variant,
          run,
          syncMs,
          visibleMs,
          warmVisibleMs,
          warmSyncMs,
          count: cache.count,
          photos: cache.photos,
          withStreams: cache.withStreams,
          withMatches: cache.withMatches,
          errors,
          responses: responses.slice(0, before),
          metrics,
        };
        await writeFile(
          new URL(`${prefix}${variant}-${run}.json`, results),
          JSON.stringify(report, null, 2),
          { mode: 0o600 },
        );
        reports.push({
          variant,
          run,
          syncMs,
          visibleMs,
          warmVisibleMs,
          warmSyncMs,
          count: cache.count,
          photos: cache.photos,
          bootstrap: report.responses.filter(
            (r) => r.path === '/api/v1/sync/bootstrap',
          ).length,
        });
        console.log(JSON.stringify(reports.at(-1)));
        await context.close();
      }
    } finally {
      await server.close();
    }
  }
  await writeFile(
    new URL(`${prefix}summary.json`, results),
    JSON.stringify(reports, null, 2),
  );
} finally {
  await browser?.close();
  await sql.end();
}
