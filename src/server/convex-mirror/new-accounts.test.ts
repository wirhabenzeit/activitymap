import assert from 'node:assert/strict';

import test from 'node:test';

import type { Writer } from '~/server/db/schema';

import {
  type FirstFetchDeps,
  LibraryMoving,
  firstFetchThroughConvex,
} from './new-accounts';

function harness(
  account: { writer: Writer; convexEpoch?: string; hasActivities?: boolean },
  options: { enabled?: boolean; moveTo?: Writer; pages?: number[] } = {},
) {
  const log: string[] = [];
  const pages = [...(options.pages ?? [3])];
  let clock = 0;
  const deps: FirstFetchDeps = {
    enabled: options.enabled ?? true,
    account: async () => ({
      writer: account.writer,
      convexEpoch: account.convexEpoch ?? null,
      hasActivities: account.hasActivities ?? false,
    }),
    prepare: async () => void log.push('prepare'),
    move: async () => {
      log.push('move');
      const writer = options.moveTo ?? 'convex';
      return writer === 'convex'
        ? { writer }
        : { writer, reason: 'The two stores differ' };
    },
    startSweep: async () => void log.push('sweep'),
    sweep: async () => {
      log.push('poll');
      const page = pages.length > 1 ? pages.shift()! : pages[0]!;
      return { phase: 'scanning', page };
    },
    count: async () => 1234,
    wait: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    onFallback: (reason) => log.push(`fallback: ${reason}`),
  };
  return { deps, log, elapsed: () => clock };
}

void test('a new account is given a library in Convex, handed over and filled from the list', async () => {
  const { deps, log } = harness({ writer: 'postgres' }, { pages: [1, 2, 3] });
  // The first fetch reports at most the first two pages' worth.
  assert.equal(await firstFetchThroughConvex(deps), 200);
  assert.deepEqual(log, ['prepare', 'move', 'sweep', 'poll', 'poll', 'poll']);
});

void test('accounts that are not new keep the Postgres path', async () => {
  for (const [account, options] of [
    [{ writer: 'postgres', hasActivities: true }, {}],
    // Being copied by the operator's move.
    [{ writer: 'postgres', convexEpoch: 'epoch-0123456789ab' }, {}],
    [{ writer: 'postgres' }, { enabled: false }],
  ] as const) {
    const { deps, log } = harness(account, options);
    assert.equal(await firstFetchThroughConvex(deps), null);
    assert.deepEqual(log, []);
  }
});

void test('an account Convex already writes just has its sweep started', async () => {
  const { deps, log } = harness({ writer: 'convex' }, { enabled: false });
  assert.equal(await firstFetchThroughConvex(deps), 200);
  assert.deepEqual(log, ['sweep', 'poll']);
});

void test('a handover that stops leaves the request to Postgres, and a handoff under way asks to retry', async () => {
  const stopped = harness({ writer: 'postgres' }, { moveTo: 'postgres' });
  assert.equal(await firstFetchThroughConvex(stopped.deps), null);
  assert.deepEqual(stopped.log, [
    'prepare',
    'move',
    'fallback: The two stores differ',
  ]);

  const moving = harness({ writer: 'handoff' });
  await assert.rejects(firstFetchThroughConvex(moving.deps), LibraryMoving);
  assert.deepEqual(moving.log, []);
});

void test('the first fetch does not wait for a sweep that is slow to start', async () => {
  const { deps, elapsed } = harness({ writer: 'convex' }, { pages: [1] });
  assert.equal(await firstFetchThroughConvex(deps), 200);
  assert.equal(elapsed(), 15_000);
});
