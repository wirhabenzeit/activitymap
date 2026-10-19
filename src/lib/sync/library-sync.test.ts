import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as ReactQuery from '@tanstack/react-query';
import {
  registerLibrarySync,
  requestLibrarySync,
  retireLibrarySync,
} from './library-sync';

const require = createRequire(import.meta.url);
const core = require.resolve('@tanstack/query-core', {
  paths: [dirname(require.resolve('@tanstack/react-query/package.json'))],
});
const { QueryClient } = (await import(pathToFileURL(core).href)) as Pick<
  typeof ReactQuery,
  'QueryClient'
>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

void test('requests during an old download await a follow-up that sees the mutation', async () => {
  const client = new QueryClient();
  const entered = deferred();
  const release = deferred();
  let serverRevision = 1;
  let visibleRevision = 0;
  let runs = 0;
  const stop = registerLibrarySync(client, 'auth:alice', async () => {
    const captured = serverRevision;
    if (++runs === 1) {
      entered.resolve();
      await release.promise;
    }
    visibleRevision = captured;
  });
  try {
    const initial = requestLibrarySync(client, 'auth:alice');
    await entered.promise;
    serverRevision = 2;
    const edited = requestLibrarySync(client, 'auth:alice');
    const secondConsumer = requestLibrarySync(client, 'auth:alice');
    release.resolve();
    await Promise.all([initial, edited, secondConsumer]);
    assert.equal(visibleRevision, 2);
    assert.equal(runs, 2);
  } finally {
    stop();
    client.clear();
  }
});

void test('same-turn requests coalesce and failed passes can be retried', async () => {
  const client = new QueryClient();
  let runs = 0;
  const stop = registerLibrarySync(client, 'auth:alice', async () => {
    if (++runs === 1) throw new Error('offline');
  });
  try {
    await Promise.all([
      assert.rejects(requestLibrarySync(client, 'auth:alice'), /offline/),
      assert.rejects(requestLibrarySync(client, 'auth:alice'), /offline/),
    ]);
    assert.equal(runs, 1);
    await requestLibrarySync(client, 'auth:alice');
    assert.equal(runs, 2);
  } finally {
    stop();
    client.clear();
  }
});

void test('rapid account return waits for old work and cleanup; late completion cannot succeed', async () => {
  const client = new QueryClient();
  const entered = deferred();
  const releaseOld = deferred();
  const releaseCleanup = deferred();
  const cleaned = deferred();
  const events: string[] = [];
  registerLibrarySync(client, 'auth:alice', async (signal) => {
    entered.resolve();
    await releaseOld.promise;
    assert.equal(signal.aborted, true);
    events.push('old-settled');
  });
  const old = requestLibrarySync(client, 'auth:alice');
  const oldRejected = assert.rejects(old, { name: 'AbortError' });
  await entered.promise;
  const retirement = retireLibrarySync(client, 'auth:alice', async () => {
    events.push('cleanup-start');
    await releaseCleanup.promise;
    events.push('cleanup-end');
    cleaned.resolve();
  });
  const stop = registerLibrarySync(client, 'auth:alice', async () => {
    events.push('new-download');
  });
  const next = requestLibrarySync(client, 'auth:alice');
  assert.deepEqual(events, []);
  releaseOld.resolve();
  await oldRejected;
  releaseCleanup.resolve();
  await Promise.all([retirement, next, cleaned.promise]);
  assert.deepEqual(events, [
    'old-settled',
    'cleanup-start',
    'cleanup-end',
    'new-download',
  ]);
  stop();
  client.clear();
});

void test('registrations are isolated by query client and an old unmount cannot abort its replacement', async () => {
  const one = new QueryClient();
  const two = new QueryClient();
  const events: string[] = [];
  const old = registerLibrarySync(one, 'auth:alice', async () => {
    events.push('old');
  });
  const current = registerLibrarySync(one, 'auth:alice', async () => {
    events.push('one');
  });
  const other = registerLibrarySync(two, 'auth:alice', async () => {
    events.push('two');
  });
  old();
  await Promise.all([
    requestLibrarySync(one, 'auth:alice'),
    requestLibrarySync(two, 'auth:alice'),
  ]);
  assert.deepEqual(events.sort(), ['one', 'two']);
  current();
  other();
  one.clear();
  two.clear();
});

void test('Strict Mode cleanup before the queued pass starts does not deadlock its replacement', async () => {
  const client = new QueryClient();
  let runs = 0;
  const oldUnmount = registerLibrarySync(client, 'auth:alice', async () => {
    assert.fail('An aborted queued registration must not run');
  });
  const old = requestLibrarySync(client, 'auth:alice');
  const rejected = assert.rejects(old, { name: 'AbortError' });
  oldUnmount();
  const stop = registerLibrarySync(client, 'auth:alice', async () => {
    runs++;
  });
  await Promise.all([rejected, requestLibrarySync(client, 'auth:alice')]);
  assert.equal(runs, 1);
  stop();
  client.clear();
});

void test('a request arriving as a completed pass finalizes still awaits a new pass', async () => {
  const client = new QueryClient();
  let runs = 0;
  let late: Promise<void> | undefined;
  const stop = registerLibrarySync(client, 'auth:alice', async () => {
    if (++runs === 1) {
      queueMicrotask(() =>
        queueMicrotask(() => {
          late = requestLibrarySync(client, 'auth:alice');
        }),
      );
    }
  });
  await requestLibrarySync(client, 'auth:alice');
  assert(late);
  await late;
  assert.equal(runs, 2);
  stop();
  client.clear();
});
