// Fixture-only Settings proof; transport and PostgreSQL have separate tests.
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';
const base = new URL(process.argv[2] || 'http://127.0.0.1:3027');
assert(['localhost', '127.0.0.1'].includes(base.hostname));
const output = resolve(process.argv[3] || '/tmp/activitymap-strava-import-browser');
const route = resolve(import.meta.dirname, '../src/app/strava-import-test');
const corpus = JSON.parse(await readFile(new URL('../shared/ingestion-status-fixtures.v1.json', import.meta.url), 'utf8'));
await mkdir(route); await mkdir(output, { recursive: true });
let browser;
try {
  await writeFile(join(route, 'page.tsx'), `
'use client';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsDialog } from '~/components/settings/settings-dialog';
import { useShallowStore } from '~/store';
export default function Proof() {
  const [client] = useState(() => new QueryClient());
  const [ready, setReady] = useState(false), [open, setOpen] = useState(true);
  useEffect(() => {
    const signIn = (id: string) => useShallowStore.getState().initializeAuth({currentUser:{id,name:'Import fixture',email:null,image:null,athlete_id:42,stravaConnected:true,stravaPermissions:{activities:'all',edit:true}}} as never);
    signIn('import-fixture');
    (window as any).__importProof = { signIn };
    setReady(true);
  }, []);
  return <QueryClientProvider client={client}>{ready && <><button onClick={() => setOpen(true)}>Open Settings</button><SettingsDialog open={open} onOpenChange={setOpen}/></>}</QueryClientProvider>;
}
`);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(error.message));
    let posts = 0, gets = 0, mode = 'idle';
    const run = () => ({ available: true, runId: mode === 'idle' ? null : 'fixture-run', status: mode,
      reason: mode === 'succeeded' ? 'complete' : null, startedAt: mode === 'idle' ? null : new Date().toISOString(), finishedAt: null,
      retryAt: mode === 'idle' ? null : new Date(Date.now() + 300_000).toISOString(), summaries: mode === 'succeeded' ? 800 : 0,
      details: mode === 'succeeded' ? 5 : 0, photos: mode === 'succeeded' ? 7 : 0 });
    await context.route('**/api/v1/ingestion-status', (req) => req.fulfill({ json: { schemaVersion: '1', serverTime: new Date().toISOString(), data: { ...corpus.scenarios[0].status, observedAt: new Date().toISOString() } } }));
    await context.route('**/api/v1/strava-import', (req) => {
      if (req.request().method() === 'POST') { posts++; mode = 'running'; }
      else { gets++; if (mode === 'running') mode = 'succeeded'; }
      return req.fulfill({ status: req.request().method() === 'POST' ? 202 : 200,
        json: { schemaVersion: '1', serverTime: new Date().toISOString(), data: run() } });
    });
    await page.goto(new URL('/strava-import-test', base).href);
    const button = page.getByRole('button', { name: 'Fetch from Strava', exact: true });
    await button.waitFor(); await button.click();
    await page.getByText(/Fetching from Strava in the background/).waitFor();
    assert.equal(posts, 1); assert.equal(await button.isDisabled(), true);
    await page.getByText(/Fetch finished/).waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /800 activity summaries fetched/);
    await page.screenshot({ path: join(output, `${viewport.width}-finished.png`) });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Open Settings' }).click();
    assert.equal(await button.isDisabled(), true); assert.equal(posts, 1);
    assert.ok(gets >= 2);
    const dialog = page.getByRole('dialog');
    assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
    assert.deepEqual(pageErrors, []);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage(); let calls = 0;
  await context.route('**/api/v1/ingestion-status', (req) => req.fulfill({ status: 404, body: 'Unavailable' }));
  await context.route('**/api/v1/strava-import', (req) => { calls++; return req.fulfill({ status: 429, headers: { 'Retry-After': '3600' }, json: { error: { code: 'rate_limited', message: 'Please wait for Strava capacity.', retryable: true, requestId: 'fixture' } } }); });
  await page.goto(new URL('/strava-import-test', base).href);
  await page.getByText(/Could not check the Strava fetch/).waitFor();
  const callsBeforeReopen = calls;
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await page.waitForTimeout(3500);
  assert.equal(calls, callsBeforeReopen, 'reopening Settings honors Retry-After');
  assert.equal(await page.getByRole('button', { name: 'Fetch from Strava', exact: true }).isDisabled(), true);
  await page.screenshot({ path: join(output, '390-rate-limit.png') });
  await context.close();
  console.log(`Settings Strava import browser proof passed; captures: ${output}`);
} finally {
  await browser?.close(); await rm(route, { recursive: true, force: true });
}
