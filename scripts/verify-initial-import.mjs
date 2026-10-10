// Real onboarding component and React Query refresh, with bounded local fixtures.
// No provider credentials or real account data are used.
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(
  ['localhost', '127.0.0.1'].includes(base.hostname),
  'Use a local dev server',
);
const output = resolve(process.argv[3] || '/tmp/activitymap-initial-import');
const route = resolve(import.meta.dirname, '../src/app/initial-import-test');
await mkdir(route); // Refuse to overwrite an existing route.
await mkdir(output, { recursive: true });
let browser;
try {
  await writeFile(
    join(route, 'page.tsx'),
    `
'use client';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { InitialImportNotice } from '~/components/auth/initial-import';
import { store, useShallowStore } from '~/store';
function Fixture() {
  const userId = useShallowStore(state => state.user?.id);
  const signIn = (id: string) => store.getState().initializeAuth({ currentUser: {
    id, name: 'Import review', email: null, image: null, athleteId: 42,
    stravaConnected: true, stravaPermissions: null,
  }});
  useEffect(() => { signIn('fixture-a'); }, []);
  const { data = 0 } = useQuery({ queryKey: ['activities', 'auth', userId],
    queryFn: async () => (await (await fetch('/initial-import-fixture/activities')).json()).count,
    enabled: Boolean(userId),
  });
  return <main className="flex h-dvh flex-col bg-background text-foreground">
    <header className="mb-4 flex min-h-14 items-center justify-between border-b px-4">
      <h1 className="font-semibold">ActivityMap</h1>
      <button onClick={() => signIn('fixture-b')}>Switch account</button>
    </header>
    <InitialImportNotice />
    <section className="min-h-0 flex-1 overflow-auto px-4" aria-label="Browse activities">
      <h2 className="text-lg font-semibold">Your activities</h2>
      <p data-browse-count={data}>{data} activities available to explore</p>
      {Array.from({length:Math.min(data, 10)}, (_, i) => <div className="mt-3 rounded-lg border p-3" key={i}>Morning ride {i + 1}</div>)}
    </section>
  </main>;
}
export default function Review() {
  const [client] = useState(() => new QueryClient({ defaultOptions: {queries:{retry:false}} }));
  return <QueryClientProvider client={client}><Fixture /></QueryClientProvider>;
}
`,
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  await context.addInitScript(() => localStorage.setItem('theme', 'light'));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const progress = (phase, count = 0, retryAt = null) => ({
    phase,
    importedCount: count,
    target: 200,
    historyComplete: phase === 'empty',
    retryAt,
    message: null,
  });
  const envelope = (data) => ({
    schemaVersion: '1',
    serverTime: new Date().toISOString(),
    data,
  });
  let mode = 'progress',
    count = 0,
    posts = 0,
    release;
  await page.route('**/initial-import-fixture/activities', (route) =>
    route.fulfill({ json: { count } }),
  );
  await page.route('**/api/v1/initial-import', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        json: envelope(
          mode === 'returning'
            ? progress('ready', 200)
            : mode === 'paused'
              ? progress(
                  'paused',
                  50,
                  new Date(Date.now() + 3600000).toISOString(),
                )
              : mode === 'concurrent'
                ? progress('importing', 50)
                : progress('not_started'),
        ),
      });
    }
    posts++;
    if (mode === 'concurrent')
      return route.fulfill({
        json: envelope({
          ...progress('failed', 50),
          message: 'Another client is finishing the import.',
        }),
      });
    if ((mode === 'progress' && posts === 2) || mode === 'switch')
      await new Promise((resolve) => {
        release = resolve;
      });
    if (mode === 'empty')
      return route.fulfill({ json: envelope(progress('empty')) });
    if (mode === 'error')
      return route.fulfill({
        status: 429,
        headers: { 'Retry-After': '3600' },
        body: '',
      });
    count = Math.min(200, count + 50);
    await route.fulfill({
      json: envelope(progress(count === 200 ? 'ready' : 'importing', count)),
    });
  });
  const load = async (nextMode) => {
    mode = nextMode;
    count = nextMode === 'paused' ? 50 : 0;
    posts = 0;
    release = undefined;
    const [response] = await Promise.all([
      page.goto(new URL('/initial-import-test', base).href, {
        timeout: 120000,
      }),
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/initial-import') &&
          response.request().method() === 'GET',
      ),
    ]);
    assert(response?.ok());
    await page.waitForFunction(() =>
      document.querySelector('[data-browse-count]'),
    );
    await page.addStyleTag({
      content: 'nextjs-portal {display:none !important}',
    });
  };
  const notice = page.getByRole('region', { name: 'Initial activity import' });
  await load('progress');
  await page.waitForFunction(() =>
    document.querySelector('[data-browse-count="50"]'),
  );
  assert.equal(
    posts,
    2,
    'First batch must be browsable before second batch finishes',
  );
  assert.equal(await page.getByRole('progressbar').getAttribute('value'), '50');
  for (const [width, height, dark] of [
    [1440, 900, false],
    [402, 874, false],
    [874, 402, false],
    [402, 874, true],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      dark,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert(
      await page.getByRole('region', { name: 'Browse activities' }).isVisible(),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: join(
        output,
        `progress-${width}x${height}${dark ? '-dark' : ''}.png`,
      ),
      animations: 'disabled',
    });
  }
  release();
  await page.waitForFunction(() =>
    document.querySelector('[data-browse-count="200"]'),
  );
  await page
    .getByText('Your recent activities are ready', { exact: true })
    .waitFor();
  assert.equal(posts, 4);
  await page.getByRole('button', { name: 'Dismiss import message' }).click();
  assert.equal(await notice.count(), 0);
  await load('empty');
  await page
    .getByText('No activities found in Strava', { exact: true })
    .waitFor();
  assert.equal(posts, 1);
  await load('paused');
  await page.getByRole('button', { name: 'Waiting to retry' }).waitFor();
  assert(
    await page.getByRole('button', { name: 'Waiting to retry' }).isDisabled(),
  );
  assert.equal(posts, 0);
  await load('error');
  await page.getByText('Activity import paused', { exact: true }).waitFor();
  assert(
    await page.getByRole('button', { name: 'Waiting to retry' }).isDisabled(),
  );
  assert.equal(posts, 1);
  await load('returning');
  assert.equal(posts, 0);
  assert.equal(await notice.count(), 0);
  await load('concurrent');
  await page.getByRole('button', { name: 'Retry import' }).waitFor();
  mode = 'returning';
  count = 200;
  await page.getByRole('button', { name: 'Retry import' }).click();
  await page
    .getByText('Your recent activities are ready', { exact: true })
    .waitFor();
  await page.waitForFunction(() =>
    document.querySelector('[data-browse-count="200"]'),
  );
  await load('switch');
  await page
    .getByText('Bringing in your recent activities', { exact: true })
    .waitFor();
  const oldRelease = release;
  await Promise.all([
    page.waitForRequest(
      (request) =>
        request.url().endsWith('/api/v1/initial-import') &&
        request.method() === 'POST',
    ),
    page.getByRole('button', { name: 'Switch account' }).click(),
  ]);
  // The new account is also held, so releasing the previous request must not publish it.
  await page.waitForFunction(
    () => document.querySelector('progress')?.getAttribute('value') === '0',
  );
  oldRelease();
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('progressbar').getAttribute('value'), '0');
  release();
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'verification.json'),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'progressive browsing',
          'four batches',
          'completion dismissal',
          'empty history',
          'stored cooldown',
          'HTTP Retry-After',
          'returning accounts',
          'completion in another client',
          'account cancellation',
          'desktop/mobile/landscape/dark geometry',
        ],
      },
      null,
      2,
    ),
  );
  console.log(`Initial import browser checks passed. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await rm(route, { recursive: true, force: true });
  // Next's dev compiler can retain a type-check stub after removing the route.
  await rm(
    resolve(import.meta.dirname, '../.next/dev/types/app/initial-import-test'),
    { recursive: true, force: true },
  );
}
