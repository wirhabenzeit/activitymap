// Real Chromium IndexedDB, production sync/client/store, shared Swift/TS vectors.
// No Next server, credentials, database, Strava requests, or external network.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(root + '/package.json');
const { chromium } = require('playwright-core');
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = await build({
  stdin: {
    contents: `import * as harness from './src/lib/sync/sync-integrity-vectors.browser'; window.harness = harness;`,
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
      : '<script src="/bundle.js"></script>',
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await page.waitForFunction(() => !!window.harness);
  const vectors = await page.evaluate(() => window.harness.runVectors());
  assert.equal(vectors.length, 14);
  const extra = await page.evaluate(() => window.harness.extraStorageChecks());
  await page.close(); // Closes the database connection; a fresh page reopens it.
  const reopened = await context.newPage();
  await reopened.goto(url);
  await reopened.waitForFunction(() => !!window.harness);
  const persisted = await reopened.evaluate(() =>
    window.harness.inspectReopened(),
  );
  console.log(
    JSON.stringify({ vectors, checks: [...extra, persisted] }, null, 2),
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
