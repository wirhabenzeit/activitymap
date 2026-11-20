// Production sync client and IndexedDB, using the hosted proof's handler adapter.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../../../package.json', import.meta.url),
);
const { chromium } = require('playwright-core');
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const {
  outputFiles: [bundle],
} = await build({
  stdin: {
    contents: `
      import { runV1Sync } from './src/lib/sync/v1-sync';
      import { clearV1Scope, readV1LibrarySnapshot } from './src/lib/sync/v1-store';
      import { loadStoredStreamSummaryBatch } from './src/lib/sync/stream-summary-sync';
      window.previewTest = { runV1Sync, clearV1Scope, readV1LibrarySnapshot, loadStoredStreamSummaryBatch };
    `,
    loader: 'ts',
    resolveDir: new URL('../../../../', import.meta.url).pathname,
  },
  bundle: true,
  platform: 'browser',
  write: false,
});

export async function openPreviewBrowser(userId, request) {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const context = await browser.newContext();
    let offline = false;
    await context.route('http://activitymap-preview.test/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: '<script src="/bundle.js"></script>',
        });
      if (url.pathname === '/bundle.js')
        return route.fulfill({
          contentType: 'text/javascript',
          body: bundle.text,
        });
      if (offline) return route.abort('internetdisconnected');
      const response = await request(url.pathname + url.search);
      return route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: await response.text(),
      });
    });
    let page;
    async function reopen() {
      await page?.close();
      page = await context.newPage();
      await page.goto('http://activitymap-preview.test/');
      await page.waitForFunction(() => !!window.previewTest);
    }
    await reopen();
    const scope = `auth:${userId}`;
    return {
      close: () => browser.close(),
      reopen,
      setOffline: (value) => {
        offline = value;
      },
      async sync(expected) {
        const result = await page.evaluate(
          (scope) => window.previewTest.runV1Sync({ scope }),
          scope,
        );
        assert.equal(result.mode, expected);
      },
      async summaries() {
        return page.evaluate(
          async ({ scope, userId }) => {
            const snapshot =
              await window.previewTest.readV1LibrarySnapshot(scope);
            const result =
              await window.previewTest.loadStoredStreamSummaryBatch({
                userId,
                activityIds: ['2'],
                observedMetadata: new Map(
                  snapshot.activities.map((row) => [row.id, row.streams]),
                ),
                signal: new AbortController().signal,
              });
            return result.get('2')?.metadata?.revision;
          },
          { scope, userId },
        );
      },
      async verify(activities, photos) {
        const actual = await page.evaluate(async (scope) => {
          const snapshot =
            await window.previewTest.readV1LibrarySnapshot(scope);
          return {
            activities: snapshot.activities.map((row) => row.id).sort(),
            photos: snapshot.photos.map((row) => row.unique_id).sort(),
          };
        }, scope);
        assert.deepEqual(actual, { activities, photos });
      },
      async signOut() {
        await page.evaluate(
          (scope) => window.previewTest.clearV1Scope(scope),
          scope,
        );
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
