import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearDeletedAccountData,
  clearLocalAccountData,
  registerAccountDeletionCleanup,
} from './account-deletion';

function browser(t: test.TestContext, events: string[]) {
  for (const [name, value] of Object.entries({
    window: { caches: {} },
    navigator: {},
    caches: {
      keys: async () => {
        events.push('cache-read');
        return ['activitymap-shell-v3', 'unrelated'];
      },
      delete: async (key: string) => {
        events.push(`cache-delete:${key}`);
        return true;
      },
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

void test('local sign-out cleanup waits for scoped writer retirement before clearing cached shell data', async (t) => {
  const events: string[] = [];
  browser(t, events);
  let release!: () => void;
  const drained = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stop = registerAccountDeletionCleanup(async (userId) => {
    events.push(`scope:${userId}`);
    await drained;
    events.push('scope-cleared');
  });
  t.after(stop);
  const pending = clearLocalAccountData('alice');
  assert.deepEqual(events, ['scope:alice']);
  release();
  await pending;
  assert.deepEqual(events, [
    'scope:alice',
    'scope-cleared',
    'cache-read',
    'cache-delete:activitymap-shell-v3',
  ]);
  assert.equal(
    clearDeletedAccountData,
    clearLocalAccountData,
    'Deletion retains the same cleanup implementation',
  );
});

void test('cleanup failure rejects before shell deletion so logout callers cannot navigate as though cleanup succeeded', async (t) => {
  const events: string[] = [];
  browser(t, events);
  const failure = new Error('Disk cleanup failed');
  const stop = registerAccountDeletionCleanup(async () => {
    throw failure;
  });
  t.after(stop);
  await assert.rejects(
    clearLocalAccountData('alice'),
    (error) => error === failure,
  );
  await assert.rejects(
    clearDeletedAccountData('alice'),
    (error) => error === failure,
  );
  assert.deepEqual(events, []);
});
