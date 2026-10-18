// Exercise the production dialog and HTTP client without creating real share links.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { build } = require(require.resolve('esbuild', { paths: [dirname(require.resolve('tsx/package.json'))] }));
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const repo = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'activitymap-direct-share-'));
const stubs = join(directory, 'stubs.ts');
await writeFile(stubs, `
export const useShallowStore = selector => selector({ selected: [101, 102] });
export const useActivities = () => ({ data: [
  { id: 101, name: 'Morning ride', start_date_local: new Date('2026-10-17T08:00:00Z') },
  { id: 102, name: 'Evening run', start_date_local: new Date('2026-10-18T18:00:00Z') },
] });
export const useToast = () => ({ toast: value => { window.shareToasts ??= []; window.shareToasts.push(value); } });
`);
const bundle = await build({
  absWorkingDir: repo, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '~/store': stubs, '~/hooks/use-activities': stubs, '~/hooks/use-toast': stubs },
  stdin: { resolveDir: repo, loader: 'tsx', contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dialog, DialogContent } from '~/components/ui/dialog';
import { CreateShareDialog } from '~/components/share/create-share-dialog';
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={new QueryClient()}>
    <Dialog open><DialogContent><CreateShareDialog onShowLinks={() => {}} /></DialogContent></Dialog>
  </QueryClientProvider>);
` },
});
const cssPath = join(repo, 'src/styles/globals.css');
const styles = await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  for (const width of [390, 860]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'en-US' });
    const errors = [];
    const requests = [];
    let fail = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://sharing.test/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/share-links') {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ status: fail ? 503 : 201, contentType: 'application/json', body: JSON.stringify(fail
          ? { error: { code: 'unavailable', message: 'Please try again later.', retryable: true, requestId: 'test' } }
          : { schemaVersion: '1', serverTime: '2026-10-18T12:00:00Z', data: { id: '8f75ec62-e2e8-4a0e-93aa-bc06268a72cb', token: 'browser-capability', expiresAt: '2026-10-25T12:00:00Z' } }) });
      } else if (path === '/fixture.js') {
        await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      } else {
        await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles.css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>` });
      }
    });
    await page.goto('http://sharing.test/');
    await page.getByRole('button', { name: 'Create link', exact: true }).waitFor();
    assert.equal(requests.length, 0, 'Opening the dialog must not create a link');
    assert.equal(await page.getByRole('button', { name: 'Continue', exact: true }).count(), 0);
    assert.equal(await page.getByRole('list', { name: 'Activities to share' }).getByRole('listitem').count(), 2);
    await page.getByRole('button', { name: 'Create link', exact: true }).click();
    await page.getByRole('heading', { name: 'Link created' }).waitFor();
    assert.deepEqual(requests, [{ activityIds: ['101', '102'], expiresInMs: 604800000, fields: { showRouteEnds: false } }]);
    assert.equal(await page.getByRole('textbox', { name: 'Share link' }).inputValue(), 'http://sharing.test/share/browser-capability');
    await page.screenshot({ path: join(directory, `created-${width}.png`) });

    fail = true;
    await page.reload();
    await page.getByRole('button', { name: 'Create link', exact: true }).click();
    await page.waitForFunction(() => window.shareToasts?.length === 1);
    assert.equal(await page.getByRole('button', { name: 'Create link', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('switch').isChecked(), false, 'Failed creation keeps privacy settings');
    assert.equal(await page.evaluate(() => window.shareToasts[0].description), 'Please try again later.');
    assert.equal(requests.length, 2, 'Failed creation is not retried automatically');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Direct share creation passed at phone and desktop widths. Captures: ${directory}`);
} finally { await browser.close(); }
