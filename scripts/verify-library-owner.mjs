// Composed library ownership proof: real hooks/provider/list + Chromium IndexedDB.
// Run against an isolated loopback Next server, never migration-bearing pnpm dev.
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(
  ['localhost', '127.0.0.1'].includes(base.hostname),
  'Use an isolated local fixture server',
);
const output = resolve(
  process.argv[3] || '/tmp/activitymap-library-owner-browser',
);
const route = join(root, 'src/app/library-owner-test');
const fixtures = JSON.parse(
  await readFile(join(root, 'shared/sync-integrity-fixtures.v1.json'), 'utf8'),
);
const activity = (id, name) => ({ ...fixtures.activity, id, name });
const photo = (id, activityId, caption) => ({
  ...fixtures.photo,
  unique_id: id,
  activity_id: activityId,
  caption,
});
const upsertActivity = (id, name, sequence = '1') => ({
  sequence,
  entityType: 'activity',
  operation: 'upsert',
  id,
  activity: activity(id, name),
});
const upsertPhoto = (id, activityId, caption, sequence = '2') => ({
  sequence,
  entityType: 'photo',
  operation: 'upsert',
  id,
  photo: photo(id, activityId, caption),
});
const remove = (entityType, id, sequence) => ({
  sequence,
  entityType,
  operation: 'delete',
  id,
});
const metadata = {
  retention: {
    retentionDays: 30,
    cursorValidUntil: '2027-01-01T00:00:00.000Z',
  },
  freshness: { lastSummaryReconciledAt: null },
};
const changes = (cursor, items = [], gate = false) => ({
  kind: 'changes',
  cursor,
  body: { ...metadata, items, nextCursor: cursor },
  gate,
});
const bootstrap = (resource, items, cursor, gate = false) => ({
  kind: 'bootstrap',
  resource,
  cursor: null,
  body: {
    ...metadata,
    resource,
    items,
    nextCursor: null,
    snapshotCursor: cursor,
  },
  gate,
});
const results = [];
const contexts = [];
let browser;
let timeout;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function scenario(name) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  const record = {
    name,
    context,
    requests: [],
    errors: [],
    console: [],
    failedRequests: [],
    unexpected: [],
    plan: [],
    pending: new Set(),
    browserFailure: deferred(),
  };
  contexts.push(record);
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  context.on('page', (page) => {
    page.on('pageerror', (error) => {
      record.errors.push(error.message);
      record.browserFailure.resolve(error);
    });
    page.on('console', (message) =>
      record.console.push({ level: message.type(), text: message.text() }),
    );
    page.on('requestfailed', (request) => {
      const error = request.failure()?.errorText ?? 'Unknown failure';
      record.failedRequests.push({
        url: request.url(),
        error,
        expectedCancellation: /ERR_ABORTED|ERR_INTERNET_DISCONNECTED/.test(
          error,
        ),
      });
    });
  });
  record.enqueue = (...steps) => {
    for (const step of steps) {
      step.reached = deferred();
      step.settled = deferred();
      step.release = deferred();
      if (!step.gate) step.release.resolve();
      record.plan.push(step);
    }
    return steps;
  };
  await context.route('**/*', async (request) => {
    const req = request.request();
    const url = new URL(req.url());
    if (
      url.origin !== base.origin ||
      req.method() !== 'GET' ||
      req.headers()['next-action']
    ) {
      record.unexpected.push({
        url: url.href,
        method: req.method(),
        action: Boolean(req.headers()['next-action']),
      });
      await request.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) return request.continue();
    const step = record.plan.shift();
    record.requests.push({
      path: url.pathname,
      cursor: url.searchParams.get('cursor'),
      resource: url.searchParams.get('resource'),
    });
    try {
      assert(step, `Unexpected API request: ${url.pathname}`);
      assert.equal(url.pathname, `/api/v1/sync/${step.kind}`);
      assert.equal(url.searchParams.get('cursor'), step.cursor);
      if (step.resource)
        assert.equal(url.searchParams.get('resource'), step.resource);
      record.pending.add(step);
      step.reached.resolve();
      await step.release.promise;
      await request
        .fulfill({
          json: {
            schemaVersion: '1',
            serverTime: '2026-10-19T00:00:00.000Z',
            data: step.body,
          },
        })
        .catch(() => undefined); // Deliberately released after scope cancellation in fence cases.
    } catch (error) {
      record.unexpected.push({ url: url.href, error: error.message });
      step?.reached.resolve();
      await request.abort().catch(() => undefined);
    } finally {
      record.pending.delete(step);
      step?.settled.resolve();
    }
  });
  record.open = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(new URL('/library-owner-test', base).href, {
      timeout: 120000,
    });
    await page.waitForFunction(() => Boolean(window.libraryProof));
    return page;
  };
  record.close = async () => {
    await context.tracing.stop({
      path: join(output, `trace-${contexts.indexOf(record)}.zip`),
    });
    await context.close();
  };
  record.finish = () => {
    assert.deepEqual(record.errors, [], `${name}: browser exceptions`);
    assert.deepEqual(
      record.failedRequests.filter((request) => !request.expectedCancellation),
      [],
      `${name}: unexpected failed requests`,
    );
    assert.deepEqual(
      record.console.filter(
        (message) =>
          message.level === 'error' &&
          !/Failed to load resource: net::ERR_(ABORTED|INTERNET_DISCONNECTED)/.test(
            message.text,
          ),
      ),
      [],
      `${name}: unexpected browser console errors`,
    );
    assert.deepEqual(
      record.unexpected,
      [],
      `${name}: no library Server Actions or unmocked requests`,
    );
    assert.equal(
      record.plan.length,
      0,
      `${name}: all expected sync requests consumed`,
    );
    assert.equal(
      record.pending.size,
      0,
      `${name}: no unresolved fixture response`,
    );
    results.push({ name, requests: record.requests.length });
    console.log(`PASS ${name}: ${record.requests.length} sync requests`);
  };
  return record;
}

const start = (page, user) =>
  page.evaluate((id) => window.libraryProof.start(id), user);
const state = (page, value) =>
  page.locator(`[data-library-state="${value}"]`).waitFor();
const row = (page, id) =>
  page.locator(`#table-main tbody tr[data-activity-id="${id}"]`);
async function view(page, names, captions) {
  await page.waitForFunction(
    ({ names, captions }) => {
      const rows = [
        ...document.querySelectorAll('#table-main tbody tr[data-activity-id]'),
      ];
      const photos = [...document.querySelectorAll('[data-library-photo]')].map(
        (node) => node.textContent,
      );
      return (
        rows.length === names.length &&
        names.every((name) =>
          rows.some((node) => node.textContent.includes(name)),
        ) &&
        JSON.stringify(photos.sort()) === JSON.stringify([...captions].sort())
      );
    },
    { names, captions },
  );
}
async function ready(page) {
  await page.locator('[data-sync-phase="ready"]').waitFor();
}
async function consume(record, step) {
  await Promise.race([step.reached.promise, record.browserFailure.promise]);
  assert.deepEqual(record.errors, [], `${record.name}: browser exceptions`);
  assert.deepEqual(record.unexpected, []);
}

async function verify() {
  // Empty partial bootstrap must never be mistaken for a successfully empty library.
  const empty = await scenario('partial versus completed empty');
  const [first, photos, caughtUp] = empty.enqueue(
    bootstrap('activities', [], 'empty0', true),
    bootstrap('photos', [], null, true),
    changes('empty0', [], true),
  );
  const emptyPage = await empty.open();
  await start(emptyPage, 'empty');
  await consume(empty, first);
  await state(emptyPage, 'unloaded');
  assert.equal(
    await emptyPage.locator('[data-has-next]').getAttribute('data-has-next'),
    'true',
  );
  first.release.resolve();
  await consume(empty, photos);
  await state(emptyPage, 'partial');
  photos.release.resolve();
  await consume(empty, caughtUp);
  await state(emptyPage, 'partial');
  caughtUp.release.resolve();
  await ready(emptyPage);
  await state(emptyPage, 'complete');
  await view(emptyPage, [], []);
  assert.equal(
    await emptyPage.locator('[data-has-next]').getAttribute('data-has-next'),
    'false',
  );
  empty.finish();
  await empty.close();

  // Publish each committed page into both mounted hook consumers, without a full fetch.
  const live = await scenario('ordered changes and durable offline reopening');
  const [activityPage, photoPage, initialDone] = live.enqueue(
    bootstrap('activities', [activity('1', 'Initial activity')], 'live0'),
    bootstrap('photos', [photo('photo:1', '1', 'Initial photo')], null, true),
    changes('live0', [], true),
  );
  let page = await live.open();
  await start(page, 'live');
  await consume(live, activityPage);
  await consume(live, photoPage);
  await state(page, 'partial');
  await view(page, ['Initial activity'], []);
  photoPage.release.resolve();
  await consume(live, initialDone);
  await view(page, ['Initial activity'], ['Initial photo']);
  initialDone.release.resolve();
  await ready(page);
  await state(page, 'complete');

  const update = changes('live0', [
    upsertActivity('1', 'Updated activity'),
    upsertPhoto('photo:1', '1', 'Updated photo'),
  ]);
  update.body.nextCursor = 'live1';
  const deletion = changes(
    'live1',
    [
      remove('activity', '1', '3'),
      remove('photo', 'photo:1', '4'),
      upsertActivity('2', 'Discarded duplicate', '5'),
      remove('activity', '2', '6'),
      upsertActivity('2', 'Final activity', '7'),
      upsertPhoto('photo:2', '2', 'Final photo', '8'),
    ],
    true,
  );
  deletion.body.nextCursor = 'live2';
  live.enqueue(update, deletion, changes('live2'));
  const sync = page.evaluate(() => window.libraryProof.sync());
  await consume(live, deletion);
  await view(page, ['Updated activity'], ['Updated photo']);
  deletion.release.resolve();
  await sync;
  await ready(page);
  await view(page, ['Final activity'], ['Final photo']);
  assert.equal(await row(page, '1').count(), 0);
  const persisted = await page.evaluate(() =>
    window.libraryProof.inspect('live'),
  );
  assert.deepEqual(persisted.activities, [{ id: '2', name: 'Final activity' }]);
  assert.deepEqual(persisted.photos, [
    { id: 'photo:2', activityId: '2', caption: 'Final photo' },
  ]);
  assert.equal(persisted.state.changesCursor, 'live2');

  const beforeReopen = live.requests.length;
  await page.close(); // Close the real IDB connection; do not retain React Query memory.
  page = await live.open();
  await live.context.setOffline(true);
  await start(page, 'live');
  await state(page, 'complete');
  await view(page, ['Final activity'], ['Final photo']);
  await page.locator('[data-sync-phase="offline"]').waitFor();
  assert.equal(
    live.requests.length,
    beforeReopen,
    'Offline reopen must read IndexedDB without refetching the library',
  );
  const retry = changes('live2', [
    upsertActivity('2', 'Retried activity'),
    upsertPhoto('photo:2', '2', 'Retried photo'),
  ]);
  retry.body.nextCursor = 'live3';
  live.enqueue(retry, changes('live3'));
  await live.context.setOffline(false);
  await ready(page);
  await view(page, ['Retried activity'], ['Retried photo']);
  const aborted = await page.evaluate(() => window.libraryProof.abortCommit());
  assert.equal(aborted.result.failed, true);
  assert.equal(aborted.result.aborts, 1);
  assert.equal(
    aborted.result.notifications,
    0,
    'Aborted IDB writes must not notify the library owner',
  );
  assert.deepEqual(aborted.result.after, aborted.result.before);
  assert.equal(
    aborted.revisionAfter,
    aborted.revisionBefore,
    'Aborted writes must not publish a new owner revision',
  );
  await view(page, ['Retried activity'], ['Retried photo']);
  // A producer without mounted owners must still invalidate another tab.
  const producer = await live.open();
  await producer.evaluate(() => window.libraryProof.mount(false));
  await producer
    .locator('[data-library-mounted="false"]')
    .waitFor({ state: 'attached' });
  await producer.evaluate(() => window.libraryProof.clearCache('live'));
  await state(page, 'unloaded');
  await view(page, [], []);
  await producer.evaluate(() =>
    window.libraryProof.seed('live', 'cross-tab0', '4', 'Cross-tab activity'),
  );
  await state(page, 'complete');
  await view(page, ['Cross-tab activity'], ['Cross-tab activity photo']);

  // After every consumer/provider releases its lease, reopening the same
  // QueryClient must re-read commits missed while detached from IndexedDB.
  await page.evaluate(() => window.libraryProof.mount(false));
  await page
    .locator('[data-library-mounted="false"]')
    .waitFor({ state: 'attached' });
  await producer.evaluate(() =>
    window.libraryProof.seed('live', 'remount0', '5', 'Remounted activity'),
  );
  const beforeRemount = live.requests.length;
  await live.context.setOffline(true);
  await page.evaluate(() => window.libraryProof.mount(true));
  await state(page, 'complete');
  await view(page, ['Remounted activity'], ['Remounted activity photo']);
  assert.equal(live.requests.length, beforeRemount);
  live.finish();
  await live.close();

  // A response that was already in flight must not repopulate a different scope.
  const fences = await scenario('late scope and deletion responses');
  const lateA = changes(
    'a0',
    [
      upsertActivity('99', 'Old account ghost'),
      upsertPhoto('photo:99', '99', 'Old account ghost photo'),
    ],
    true,
  );
  lateA.body.nextCursor = 'a1';
  const lateB = changes(
    'b0',
    [upsertActivity('88', 'Other account ghost')],
    true,
  );
  lateB.body.nextCursor = 'b1';
  fences.enqueue(lateA, lateB, changes('a-return0'));
  const fencePage = await fences.open();
  await fencePage.evaluate(() =>
    window.libraryProof.seed('account-A', 'a0', '1', 'Account A'),
  );
  await start(fencePage, 'account-A');
  await consume(fences, lateA);
  await view(fencePage, ['Account A'], ['Account A photo']);
  await fencePage.evaluate(() =>
    window.libraryProof.seed('account-B', 'b0', '2', 'Account B'),
  );
  await start(fencePage, 'account-B');
  await consume(fences, lateB);
  await view(fencePage, ['Account B'], ['Account B photo']);
  // Return to the same account identity with a new owner generation before
  // either old request finishes. The old A response must not match new A.
  await fencePage.evaluate(() =>
    window.libraryProof.seed(
      'account-A',
      'a-return0',
      '3',
      'Returned account A',
    ),
  );
  await start(fencePage, 'account-A');
  await ready(fencePage);
  await view(fencePage, ['Returned account A'], ['Returned account A photo']);
  lateA.release.resolve();
  lateB.release.resolve();
  await Promise.all([lateA.settled.promise, lateB.settled.promise]);
  await view(fencePage, ['Returned account A'], ['Returned account A photo']);
  assert.equal(await row(fencePage, '99').count(), 0);
  assert.equal(await row(fencePage, '88').count(), 0);

  const lateDeletion = changes(
    'a-return0',
    [upsertActivity('98', 'Deleted account ghost')],
    true,
  );
  lateDeletion.body.nextCursor = 'a-return1';
  fences.enqueue(lateDeletion);
  const pending = fencePage.evaluate(() =>
    window.libraryProof.sync().catch((error) => error.name),
  );
  await consume(fences, lateDeletion);
  const cleared = fencePage.evaluate(() => window.libraryProof.clear());
  await fencePage.locator('[data-library-user="none"]').waitFor();
  lateDeletion.release.resolve();
  await Promise.all([pending, cleared, lateDeletion.settled.promise]);
  await view(fencePage, [], []);
  const deleted = await fencePage.evaluate(() =>
    window.libraryProof.inspect('account-A'),
  );
  assert.deepEqual(deleted.activities, []);
  assert.deepEqual(deleted.photos, []);
  assert.equal(deleted.state, null);
  fences.finish();
}

const fixtureSource = `
'use client';
import { Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ActivityListView } from '~/components/list/activity-list';
import { OfflineSyncProvider } from '~/components/providers/offline-sync';
import { useActivities } from '~/hooks/use-activities';
import { usePhotos } from '~/hooks/use-photos';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import { getLibraryOwner } from '~/lib/sync/library-owner';
import { requestLibrarySync } from '~/lib/sync/library-sync';
import { useBrowserSyncStatus } from '~/lib/sync/browser-status';
import { clearDeletedAccountData } from '~/lib/account-deletion';
import { seedLibrary, inspectLibrary, clearLibrary, abortLibraryCommit } from '~/lib/sync/library-owner-vectors.browser';
import { useShallowStore } from '~/store';
function OwnerState({ scope }: { scope: string }) {
  const client = useQueryClient();
  const owner = getLibraryOwner(client, scope);
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getServerSnapshot);
  return <output data-library-state={snapshot.completeness}>{snapshot.completeness}</output>;
}
function Controls({ setMounted }: { setMounted: (value: boolean) => void }) {
  const client = useQueryClient();
  useEffect(() => {
    (window as any).libraryProof = {
      start: (id: string) => useShallowStore.getState().initializeAuth({ currentUser: { id, name: id, email: null, image: null, athlete_id: 42, stravaConnected: true } }),
      seed: seedLibrary,
      clearCache: clearLibrary,
      mount: setMounted,
      inspect: inspectLibrary,
      sync: () => requestLibrarySync(client, 'auth:' + useShallowStore.getState().user!.id),
      clear: () => clearDeletedAccountData(useShallowStore.getState().user!.id),
      abortCommit: async () => {
        const user = useShallowStore.getState().user!.id;
        const owner = getLibraryOwner(client, 'auth:' + user);
        const revisionBefore = owner.getSnapshot().revision;
        const result = await abortLibraryCommit(user);
        return { result, revisionBefore, revisionAfter: owner.getSnapshot().revision };
      },
    };
    return () => { delete (window as any).libraryProof; };
  }, [client, setMounted]);
  return null;
}
function Library() {
  const userId = useShallowStore(state => state.user?.id);
  const activities = useActivities();
  const photos = usePhotos();
  const { filterIDs } = useFilteredActivities();
  const phase = useBrowserSyncStatus(state => userId ? state.byUser[userId]?.phase : 'idle');
  return <div className="flex h-dvh flex-col" data-library-user={userId ?? 'none'}>
    <OfflineSyncProvider />
    <div><output data-sync-phase={phase}>{phase}</output><output data-has-next={String(activities.hasNextPage)}>{String(activities.hasNextPage)}</output>{userId && <OwnerState scope={'auth:' + userId} />}</div>
    <ul aria-label="Library photos">{(photos.data ?? []).map(photo => <li key={photo.unique_id} data-library-photo={photo.unique_id}>{photo.caption}</li>)}</ul>
    <div className="min-h-0 flex-1"><ActivityListView activities={activities.data} photos={photos.data} filterIDs={filterIDs} hasNextPage={activities.hasNextPage} isFetching={activities.isFetching} /></div>
  </div>;
}
export default function Review() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [mounted, setMounted] = useState(true);
  return <Suspense><QueryClientProvider client={client}><Controls setMounted={setMounted} /><div data-library-mounted={String(mounted)}>{mounted && <Library />}</div></QueryClientProvider></Suspense>;
}
`;

export async function prepareLibraryFixture(directory = root) {
  const fixtureRoute = join(directory, 'src/app/library-owner-test');
  await mkdir(fixtureRoute); // Never replace another invocation's fixture.
  try {
    await writeFile(join(fixtureRoute, 'page.tsx'), fixtureSource, {
      flag: 'wx',
    });
  } catch (error) {
    await rm(fixtureRoute, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const abort = new AbortController();
  const interrupted = new Promise((_, reject) =>
    abort.signal.addEventListener(
      'abort',
      () => reject(new Error('Library proof interrupted')),
      { once: true },
    ),
  );
  void interrupted.catch(() => undefined); // The compile phase may observe abort before the assertion race.
  const interrupt = () => {
    process.exitCode = 130;
    abort.abort();
  };
  const terminate = () => {
    process.exitCode = 143;
    abort.abort();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  await mkdir(output, { recursive: true });
  if (process.env.LIBRARY_OWNER_PREPARED !== '1') await prepareLibraryFixture();
  try {
    const deadline = AbortSignal.any([
      abort.signal,
      AbortSignal.timeout(120000),
    ]);
    while (true) {
      const response = await fetch(new URL('/library-owner-test', base), {
        signal: deadline,
      });
      await response.arrayBuffer();
      if (response.ok) break;
      assert.equal(
        response.status,
        404,
        `Fixture compilation failed: ${response.status}`,
      );
      await delay(200, undefined, { signal: deadline });
    }
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    });
    await Promise.race([
      verify(),
      interrupted,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error('Library owner browser proof exceeded 180 seconds'),
            ),
          180000,
        );
      }),
    ]);
    await writeFile(
      join(output, 'result.json'),
      JSON.stringify(
        {
          passed: true,
          runId: process.env.LIBRARY_OWNER_RUN_ID ?? null,
          results,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        {
          passed: true,
          runId: process.env.LIBRARY_OWNER_RUN_ID ?? null,
          results,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack ?? String(error));
    for (const [index, record] of contexts.entries()) {
      await Promise.allSettled(
        record.context.pages().map(async (page, pageIndex) => {
          await page.screenshot({
            path: join(output, `failure-${index}-${pageIndex}.png`),
            timeout: 5000,
          });
          await writeFile(
            join(output, `failure-${index}-${pageIndex}.html`),
            await page.content(),
          );
        }),
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    for (const [index, record] of contexts.entries()) {
      for (const step of record.pending) step.release.resolve();
      await writeFile(
        join(output, `requests-${index}.json`),
        JSON.stringify(
          {
            name: record.name,
            requests: record.requests,
            unexpected: record.unexpected,
            errors: record.errors,
            console: record.console,
            failedRequests: record.failedRequests,
          },
          null,
          2,
        ),
      );
      await record.context.tracing
        .stop({ path: join(output, `trace-${index}.zip`) })
        .catch(() => undefined);
    }
    await browser?.close();
    await rm(route, { recursive: true, force: true });
    await rm(join(root, '.next/dev/types/app/library-owner-test'), {
      recursive: true,
      force: true,
    });
  }
}

if (
  process.argv[1] &&
  (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)
)
  await main();
