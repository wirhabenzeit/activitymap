// Fixture-only browser proof: no real account or database writes.
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3018');
assert(
  ['localhost', '127.0.0.1'].includes(base.hostname),
  'Use a local dev server',
);
const output = resolve(
  process.argv[3] || '/tmp/activitymap-account-deletion-browser',
);
const route = resolve(import.meta.dirname, '../src/app/account-deletion-test');
await mkdir(route);
await mkdir(output, { recursive: true });
let browser;
try {
  await writeFile(
    join(route, 'page.tsx'),
    `
'use client';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsDialog } from '~/components/settings/settings-dialog';
import { OfflineSyncProvider } from '~/components/providers/offline-sync';
import { useShallowStore } from '~/store';
import { upsertActivityDTOs, getCachedActivityDTOs, setV1SyncState } from '~/lib/sync/v1-store';
import { activityDTOSchema } from '~/contracts/v1/activity';
import fixture from '../../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';
export default function Review() {
  const [client] = useState(() => new QueryClient());
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    void (async () => {
      const defaults = Object.fromEntries(Object.keys(activityDTOSchema.shape).filter(key => key !== 'streams').map(key => [key, null]));
      const activity = activityDTOSchema.parse({...defaults, ...fixture.activities[0]});
      await upsertActivityDTOs('auth:deletion-fixture', [activity]);
      await setV1SyncState({scope:'auth:deletion-fixture',bootstrapCursor:'fixture',bootstrapComplete:true,changesCursor:'fixture',lastSyncAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
      useShallowStore.getState().initializeAuth({currentUser:{id:'deletion-fixture',name:'Deletion fixture',email:null,image:null,athlete_id:42,stravaConnected:true}} as never);
      (window as any).__deletionProof = { cached: () => getCachedActivityDTOs('auth:deletion-fixture'), user: () => useShallowStore.getState().user };
      setReady(true);
    })();
  }, []);
  return <QueryClientProvider client={client}>{ready && <><OfflineSyncProvider/><SettingsDialog open={open} onOpenChange={setOpen}/></>}</QueryClientProvider>;
}
`,
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  let deletionRequests = 0;
  let shouldFail = true;
  let releaseSync;
  const gatedSync = new Promise((resolve) => {
    releaseSync = resolve;
  });
  await context.route('**/api/v1/sync/changes*', async (request) => {
    await gatedSync;
    await request.abort().catch(() => undefined);
  });
  await context.route('**/api/v1/ingestion-status*', (request) =>
    request.fulfill({
      status: 503,
      json: {
        error: {
          code: 'unavailable',
          message: 'Fixture',
          retryable: false,
          requestId: 'fixture',
        },
      },
    }),
  );
  await context.route('**/api/v1/account/delete', (request) => {
    deletionRequests++;
    assert.deepEqual(request.request().postDataJSON(), {
      confirmation: 'DELETE',
    });
    return request.fulfill({
      status: shouldFail ? 500 : 200,
      json: {
        schemaVersion: '1',
        serverTime: new Date().toISOString(),
        data: { status: 'deleted' },
      },
    });
  });
  await context.route('**/api/auth/sign-out', (request) =>
    request.fulfill({ json: { success: true } }),
  );
  await context.route(new URL('/map', base).toString(), (request) =>
    request.fulfill({ contentType: 'text/html', body: '<p>Signed out</p>' }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.goto(new URL('/account-deletion-test', base).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await page
    .getByRole('button', { name: 'Delete account and data', exact: true })
    .click();
  assert.equal(deletionRequests, 0, 'Opening confirmation must not delete');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(deletionRequests, 0);
  await page
    .getByRole('button', { name: 'Delete account and data', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Permanently delete my account', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'phone-confirmation.png') });
  await page
    .getByRole('button', { name: 'Permanently delete my account', exact: true })
    .click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Couldn’t confirm account deletion' })
    .waitFor();
  assert.equal(
    await page.evaluate(
      async () => (await window.__deletionProof.cached()).length,
    ),
    1,
    'Failed deletion must retain the cache',
  );
  assert.equal(
    await page.evaluate(() => window.__deletionProof.user().id),
    'deletion-fixture',
  );

  const other = await context.newPage();
  await other.goto(new URL('/account-deletion-test', base).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await other.getByRole('tab', { name: 'Account', exact: true }).click();
  shouldFail = false;
  await page
    .getByRole('button', { name: 'Permanently delete my account', exact: true })
    .click();
  releaseSync();
  await page.waitForURL(new URL('/map', base).toString());
  await other.waitForFunction(
    () => window.__deletionProof.user() === undefined,
  );
  assert.equal(
    await other.evaluate(
      async () => (await window.__deletionProof.cached()).length,
    ),
    0,
    'Other open tabs must clear the deleted cache',
  );
  assert.equal(deletionRequests, 2);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'confirmation',
          'cancel',
          'failure preserves account/cache',
          'successful deletion',
          'pending sync fenced',
          'cross-tab cleanup',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Account deletion browser proof passed.');
} finally {
  await browser?.close();
  await rm(route, { recursive: true, force: true });
  await rm(resolve(import.meta.dirname, '../.next/dev/types/app/account-deletion-test'), { recursive: true, force: true });
}
