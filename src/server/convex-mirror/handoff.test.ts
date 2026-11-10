import assert from 'node:assert/strict';

import test from 'node:test';

import type { Writer } from '~/server/db/schema';

import {
  type HandoffDeps,
  handBackToPostgres,
  handOffToConvex,
} from './handoff';

/** Two stores with a writer and an epoch each, and a record of what ran. */
function stores(
  initial: { postgres?: Writer; convex?: Writer; backend?: string } = {},
) {
  const log: string[] = [];
  const store = (name: string, writer: Writer) => {
    const state = { writer, epoch: 3 };
    return {
      state,
      setWriter: async (next: Writer, expectedEpoch: number) => {
        if (state.epoch !== expectedEpoch) return null;
        state.writer = next;
        state.epoch++;
        log.push(`${name} ${next}`);
        return state.epoch;
      },
    };
  };
  const postgres = store('postgres', initial.postgres ?? 'postgres');
  const convex = store('convex', initial.convex ?? 'postgres');
  const world = {
    log,
    postgres: postgres.state,
    convex: convex.state,
    /** Mirror runs still needed to reach the head. */
    behind: 1,
    drift: false,
    clock: 0,
  };
  const deps: HandoffDeps = {
    postgres: {
      state: async () => ({ ...postgres.state }),
      setWriter: postgres.setWriter,
      reconcileNow: async () => void log.push('reconcile'),
    },
    convex: {
      state: async () => ({
        ...convex.state,
        backend: initial.backend ?? 'convex',
        revoked: false,
      }),
      setWriter: convex.setWriter,
    },
    mirror: async () => {
      // Postgres must have stopped writing before the last copy.
      assert.equal(postgres.state.writer, 'handoff');
      log.push('mirror');
      world.clock += 10_000;
      world.behind = Math.max(0, world.behind - 1);
      return { complete: world.behind === 0 };
    },
    parity: async () => {
      log.push('parity');
      return { status: world.drift ? 'drift' : 'ok' };
    },
    dispatch: async () => void log.push('dispatch'),
    now: () => world.clock,
  };
  return { world, deps };
}

void test('a handoff stops Postgres, copies, compares, then makes Convex the writer', async () => {
  const { world, deps } = stores();
  world.behind = 2;

  const report = await handOffToConvex(deps);

  assert.deepEqual(world.log, [
    'postgres handoff',
    'mirror',
    'mirror',
    'parity',
    'convex convex',
    'postgres convex',
    'dispatch',
  ]);
  assert.deepEqual(
    [report.outcome, report.writer, report.reason],
    ['moved', 'convex', undefined],
  );
  assert.deepEqual(
    [world.postgres.writer, world.convex.writer],
    ['convex', 'convex'],
  );

  // Running it again changes nothing, and sends events still waiting.
  world.log.length = 0;
  assert.equal((await handOffToConvex(deps)).outcome, 'already');
  assert.deepEqual(world.log, ['dispatch']);
});

void test('a copy that does not finish, or stores that differ, leave the account with Postgres', async () => {
  const slow = stores();
  slow.world.behind = 10;
  const late = await handOffToConvex(slow.deps);
  assert.deepEqual(
    [late.outcome, late.writer, slow.world.convex.writer],
    ['aborted', 'postgres', 'postgres'],
  );
  assert.match(late.reason!, /did not finish in time/);
  // Four ten-second runs fit the forty-second budget.
  assert.equal(slow.world.log.filter((entry) => entry === 'mirror').length, 4);
  assert(!slow.world.log.includes('parity'));

  const differing = stores();
  differing.world.drift = true;
  const drift = await handOffToConvex(differing.deps);
  assert.deepEqual(
    [drift.outcome, drift.writer, differing.world.convex.writer],
    ['aborted', 'postgres', 'postgres'],
  );
  assert.deepEqual(differing.world.log, [
    'postgres handoff',
    'mirror',
    'parity',
    'postgres postgres',
  ]);
});

void test('a handoff refuses an account that Convex cannot take', async () => {
  for (const initial of [
    { backend: 'postgres' },
    { convex: 'handoff' as const },
    { postgres: 'convex' as const },
  ]) {
    const { world, deps } = stores(initial);
    const report = await handOffToConvex(deps);
    assert.equal(report.outcome, 'aborted', JSON.stringify(initial));
    assert.deepEqual(world.log, []);
  }
});

void test('an interrupted handoff continues from where the two stores are', async () => {
  // Stopped after Postgres paused: the copy and the check run again.
  const paused = stores({ postgres: 'handoff' });
  assert.equal((await handOffToConvex(paused.deps)).outcome, 'moved');
  assert.deepEqual(paused.world.log, [
    'mirror',
    'parity',
    'convex convex',
    'postgres convex',
    'dispatch',
  ]);

  // Stopped after Convex became the writer: only Postgres is left.
  const half = stores({ postgres: 'handoff', convex: 'convex' });
  assert.equal((await handOffToConvex(half.deps)).outcome, 'moved');
  assert.deepEqual(half.world.log, ['postgres convex', 'dispatch']);
});

void test('a handoff that loses to another one changes nothing further', async () => {
  const { world, deps } = stores();
  deps.parity = async () => {
    // Someone else moves the Convex owner while this run compares.
    world.convex.epoch++;
    return { status: 'ok' };
  };

  const report = await handOffToConvex(deps);

  assert.equal(report.outcome, 'aborted');
  assert.match(report.reason!, /another handoff/);
  assert.deepEqual(
    [world.postgres.writer, world.convex.writer],
    ['postgres', 'postgres'],
  );
});

void test('handing back stops Convex first and makes Postgres reconcile at once', async () => {
  const { world, deps } = stores({ postgres: 'convex', convex: 'convex' });

  const report = await handBackToPostgres(deps);

  assert.deepEqual(world.log, [
    'convex handoff',
    'postgres postgres',
    'convex postgres',
    'reconcile',
  ]);
  assert.deepEqual([report.outcome, report.writer], ['moved', 'postgres']);
  // Nothing is copied or compared on the way back.
  assert(!world.log.includes('mirror') && !world.log.includes('parity'));

  world.log.length = 0;
  assert.equal((await handBackToPostgres(deps)).outcome, 'already');
  assert.deepEqual(world.log, []);
});

void test('handing back also recovers a handoff that stopped half way', async () => {
  for (const [initial, expected] of [
    [
      { postgres: 'handoff', convex: 'postgres' },
      ['postgres postgres', 'reconcile'],
    ],
    [
      { postgres: 'handoff', convex: 'convex' },
      ['convex handoff', 'postgres postgres', 'convex postgres', 'reconcile'],
    ],
    [
      { postgres: 'postgres', convex: 'handoff' },
      ['convex postgres', 'reconcile'],
    ],
  ] as const) {
    const { world, deps } = stores(initial);
    assert.equal((await handBackToPostgres(deps)).outcome, 'moved');
    assert.deepEqual(world.log, expected);
    assert.deepEqual(
      [world.postgres.writer, world.convex.writer],
      ['postgres', 'postgres'],
    );
  }
});
